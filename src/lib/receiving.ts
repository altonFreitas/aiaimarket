import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { landedCosts, isResaleLine, parseSizes } from "@/lib/procurement";
import { normalizeSizeQty } from "@/lib/sizeStock";
import { normalizeVariantQty, receiptMovementsFor } from "@/lib/variantStock";
import { submittedFrom } from "@/lib/taxonomy/lineTaxonomy";
import { attributesForType } from "@/lib/data/taxonomy";
import { validateAttributeValues } from "@/lib/taxonomy/validate";
import type { FormAttribute } from "@/lib/taxonomy/types";
import { isMissingColumnError } from "@/lib/missingColumn";
import { slugify } from "@/lib/utils";
import { revalidatePath, updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";
import type { PurchaseOrder } from "@/lib/types";

/* Receiving a purchase order: the one event that writes everything
 * downstream. For each line bought FOR RESALE it
 *
 *   1. creates the catalog product, if the line does not already point at one
 *   2. gives it the product TYPE the line was bought under, and the answers
 *      the buyer gave to that type's questions -- which is what makes the
 *      new listing draw its own fields, show a Specifications panel and
 *      appear under the attribute filters, with nobody retyping anything
 *   3. writes a stock_movements row, which the database trigger turns into
 *      stock on the product
 *   4. upserts the landed unit cost into product_costs
 *
 * Lines that are not for resale are skipped entirely -- an office chair is a
 * real purchase that must never appear in the shop.
 *
 * IDEMPOTENCE is enforced by the database, not by checking first: a unique
 * index on stock_movements(po_item_id, size, variant) where reason =
 * 'purchase_receipt' means a second receipt of the same line and the same
 * combination is rejected by Postgres. That is
 * deliberate. A check-then-insert would still double-count under two
 * concurrent clicks; a constraint cannot. We catch the violation per line
 * and carry on, so re-receiving an order tops up only the lines that were
 * genuinely missed.
 *
 * WHOSE SHELF THE GOODS LAND ON. `sellerId` is the store receiving them, or
 * null for the marketplace's own. It decides one thing -- the seller_id of
 * any product this receipt CREATES -- and it matters: a seller receiving
 * their own order must end up with their own listing, carrying their own
 * "Sold by" line, counted in their own figures. Without it the store would
 * buy the goods and the marketplace would own the product.
 *
 * Not exported from a "use server" file, for the reason given at the top of
 * lib/purchasing.ts: an exported action taking a seller id would let anyone
 * name one.
 */

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = "23505";

export interface ReceiptResult {
  /** Lines that added stock on this run. */
  received: number;
  /** Lines already received before -- skipped, not an error. */
  alreadyReceived: number;
  /** Non-resale lines, which never touch stock. */
  skipped: number;
  /** Catalog products created by this receipt. */
  productsCreated: number;
}

async function nextProductRef(): Promise<string> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("products").select("ref").like("ref", "PRD-%")
    .order("ref", { ascending: false }).limit(1).maybeSingle();
  const highest = data?.ref ? parseInt(String(data.ref).slice(4), 10) : 0;
  let n = (Number.isFinite(highest) ? highest : 0) + 1;
  for (let attempt = 0; attempt < 25; attempt++, n++) {
    const ref = "PRD-" + String(n).padStart(4, "0");
    const { data: clash } = await sb.from("products").select("id").eq("ref", ref).maybeSingle();
    if (!clash) return ref;
  }
  throw new Error("Could not generate a unique product reference — please try again");
}

/** A slug free of collisions, since two suppliers may sell "Blue Shirt". */
async function freeSlug(name: string): Promise<string> {
  const sb = supabaseAdmin();
  const base = slugify(name) || "product";
  for (let n = 0; n < 50; n++) {
    const slug = n === 0 ? base : `${base}-${n + 1}`;
    const { data } = await sb.from("products").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
  }
  return `${base}-${Date.now()}`;
}

/** Apply a purchase order's resale lines to stock, the catalog and costs.
 *
 * Called when an order reaches "received". Safe to call again: lines already
 * received are reported rather than re-applied. */
export async function applyReceipt(
  poId: string, sellerId: string | null
): Promise<ReceiptResult> {
  const sb = supabaseAdmin();

  const { data: po, error } = await sb
    .from("purchase_orders")
    .select("*, items:purchase_order_items(*)")
    .eq("id", poId)
    .maybeSingle();
  if (error) throw error;
  if (!po) throw new Error("Purchase order not found");

  const order = po as PurchaseOrder;
  const items = order.items || [];
  // Costs are computed over ALL lines, because freight is shared with the
  // non-resale ones too -- a box of office paper in the same container took
  // up space that the resale goods did not pay for.
  const costs = landedCosts(order);
  const costByItem = new Map(costs.map((c) => [c.itemId, c]));

  const result: ReceiptResult = {
    received: 0, alreadyReceived: 0, skipped: 0, productsCreated: 0,
  };

  /* SEVERAL LINES, ONE PRODUCT.
   *
   * A line is one SKU now -- one size, one colour, its own cost and its
   * own price -- so an order for a shirt in S, M and L arrives here as
   * three lines naming the same shirt. Creating a product per line would
   * put three "Blue Shirt" listings in the shop, each holding a third of
   * the stock, each with its own slug, and the shopper would find all
   * three.
   *
   * Keyed by the name the buyer typed, folded for case and spacing,
   * because that is what the buyer meant by "the same product" -- they
   * typed it once and generated the rest. Only within THIS receipt: two
   * orders months apart naming the same thing are a judgement this has no
   * business making silently, and the line's own product_id is how a
   * restock says "that one". */
  const createdHere = new Map<string, string>();
  const productKey = (name: string) =>
    String(name || "").trim().toLowerCase().replace(/\s+/g, " ");

  /* An order for twelve SKUs names one product type twelve times, and it
     asks the same questions every time. Read once. */
  const attrCache = new Map<string, FormAttribute[]>();
  const attrsOf = async (typeId: string): Promise<FormAttribute[]> => {
    const got = attrCache.get(typeId);
    if (got) return got;
    const list = await attributesForType(typeId, { includeAdminOnly: true });
    attrCache.set(typeId, list);
    return list;
  };

  for (const item of items) {
    if (!isResaleLine(item)) { result.skipped++; continue; }

    const cost = costByItem.get(item.id);
    // Stock is whole units even though a purchase line may be fractional
    // (3.5 metres of cloth). Round down: claiming stock you do not have is
    // worse than under-reporting it.
    const units = Math.floor(Number(item.qty) || 0);
    if (units < 1) { result.skipped++; continue; }

    /* Null here says exactly "no product carries this line yet" -- the
       order did not name one and no earlier line in this receipt has
       made one. The `if (!productId)` below is that same question, so
       there is no second flag saying it again. */
    let productId = item.product_id || createdHere.get(productKey(item.product_name)) || null;

    // Create the product now, not when the order was drafted: an order that
    // never arrives must not leave unbuyable products in the shop.
    if (!productId) {
      const [ref, slug] = await Promise.all([
        nextProductRef(), freeSlug(item.product_name),
      ]);
      const { data: created, error: createErr } = await sb
        .from("products")
        .insert({
          ref, slug,
          name: item.product_name,
          // Absent for the marketplace's own, so the column's default
          // (current_seller_id()) still applies exactly as it always has.
          ...(sellerId ? { seller_id: sellerId } : {}),
          category_id: item.catalog_category_id ?? null,
          // The buyer states the shelf price; falling back to the landed
          // cost would list the goods at break-even, which is worse than
          // obvious: it looks like a real decision.
          price: Number(item.sell_price ?? 0),
          qty: 0,               // the movement below is what adds the stock
          stock_status: "out",
          status: "approved",
          archived: false,
          // Both come from the purchase order, which is where the buyer
          // already knew them. Without this the new listing showed
          // "SIZE —" and an empty description until someone retyped what
          // they had just entered on the order.
          sizes: parseSizes(item.sizes),
          description: item.description || "",
          images: [],
        })
        .select("id")
        .single();
      if (createErr) throw createErr;
      productId = created.id as string;
      createdHere.set(productKey(item.product_name), productId);
      result.productsCreated++;

      // What kind of thing it is, and what it answers. Only for a product
      // this receipt CREATED -- see applyTaxonomy.
      await applyTaxonomy(productId, item, attrsOf);

      // Point the line at what it created, so a second receipt tops up this
      // product rather than creating a duplicate.
      await sb.from("purchase_order_items")
        .update({ product_id: productId }).eq("id", item.id);
    }

    // An existing product is FILLED IN, never overwritten. Someone may
    // have written a careful description for the shop's own listing, and a
    // restock must not replace it with whatever the supplier called it.
    // Only genuinely blank fields are touched.
    else if (item.sizes || item.description) {
      const { data: current } = await sb
        .from("products").select("sizes, description")
        .eq("id", productId).maybeSingle();
      if (current) {
        const patch: Record<string, unknown> = {};
        const incomingSizes = parseSizes(item.sizes);
        if (incomingSizes.length && !(current.sizes as string[] | null)?.length) {
          patch.sizes = incomingSizes;
        }
        if (item.description && !String(current.description || "").trim()) {
          patch.description = item.description;
        }
        if (Object.keys(patch).length) {
          await sb.from("products").update(patch).eq("id", productId);
        }
      }
    }

    /* AND THE SAME RULE FOR THE TYPE, on a product that already exists:
       filled in when it has none, never replaced when it has one.
       Replacing would be the most destructive thing a restock could do --
       changing a product's type changes WHICH QUESTIONS EXIST, so every
       answer the shop had written would be an answer to a question the new
       type never asked, and saveProductAttributes deletes those. A shirt
       restocked from a supplier who files it differently would come back
       from the delivery with its whole specification gone. */
    if (item.product_id && productId) await fillBlankTaxonomy(productId, item, attrsOf);

    /* THE LEDGER ROWS -- one per size. The trigger on stock_movements
       moves products.qty, which stays the sum of all of them.

       A line that names no sizes yields a single unsized movement, which
       is exactly what every receipt did before this existed and what a
       fridge still does. A line buying 5 S, 10 M and 15 L yields three,
       and the unique index is on (po_item_id, size) so each is idempotent
       on its own -- see supabase/size-stock.sql.

       A line buying variants yields one movement per VARIANT instead,
       and ignores its size map -- a variant already carries its size, so
       honouring both would count the same shirts twice.

       Inserted as ONE statement rather than a loop: all the sizes of a
       line arrive together or none do, so a receipt cannot half-land and
       leave the shop believing in stock that was never counted. */
    /* THE VARIANT THIS LINE BUYS, created if the product has not got it.
       This is where one line becomes one SKU: the answers the buyer gave
       to the product type's variant axes -- Size S, Colour Black -- become
       a row in product_variants carrying this line's own selling price,
       and the movement below carries its id. A line with no axes answered
       returns null and receives exactly as it always did. */
    const lineVariant = await ensureVariant(
      productId, item, attrsOf,
      cost ? Number(cost.landedUnitCost.toFixed(4)) : null);

    /* THE PRODUCT'S LIST OF SIZES, which is what the storefront's picker
       draws from. Built up as the lines land rather than typed: the sizes
       box that used to say "S, M, L" is gone, and the sizes are now
       whatever the lines actually bought. */
    if (lineVariant?.size) await addSize(productId, lineVariant.size);

    /* THE PRICE ON THE CARD IS THE CHEAPEST ONE THAT IS TRUE.
       A shirt bought in three sizes at three prices has three variant
       prices and one product price, and the card, the grid and the search
       results all show the product's. Taking the first line's would mean a
       shopper who clicked a $45 card could find every size costs more,
       which is the one direction a price must never be wrong in.

       ONLY FOR A PRODUCT THIS RECEIPT CREATED. A restock must not reprice
       a listing the shop has since set deliberately -- see createdHere,
       which holds exactly the products made a moment ago. */
    if (lineVariant && createdHere.get(productKey(item.product_name)) === productId
        && item.sell_price != null) {
      await lowerPriceTo(productId, Number(item.sell_price));
    }

    /* WHICH SIZE EACH VARIANT IS, for the column that has not retired.
       Every movement still carries a size -- the per-size views and the
       reorder report read it -- and a variant receipt that left it empty
       would quietly move that stock into the "no size recorded" pool,
       which backs every size. Read once per line rather than once per
       movement.

       A line that names its own variant needs no lookup: it has just been
       told what that variant is. variant_qty is the OLD shape -- an order
       placed before a line was one SKU, buying several variants at once --
       and is still honoured. */
    const variantQty = lineVariant
      ? { [lineVariant.id]: units }
      : normalizeVariantQty(item.variant_qty);
    const sizeByVariant = new Map<string, string>();
    if (lineVariant) sizeByVariant.set(lineVariant.id, lineVariant.size);
    const variantIds = lineVariant ? [] : Object.keys(variantQty);
    if (variantIds.length) {
      const { data: rows } = await sb
        .from("variant_attribute_values")
        .select("variant_id, value, attributes!inner(slug)")
        .in("variant_id", variantIds)
        .eq("attributes.slug", "size");
      for (const r of (rows ?? []) as { variant_id: string; value: string }[]) {
        sizeByVariant.set(r.variant_id, r.value);
      }
    }

    const moves = receiptMovementsFor(
      normalizeSizeQty(item.size_qty), variantQty, units,
      (id) => sizeByVariant.get(id) ?? "");
    const { error: moveErr } = await sb.from("stock_movements").insert(
      moves.map((m) => ({
        product_id: productId,
        variant_id: m.variantId,
        size: m.size,
        delta: m.qty,
        reason: "purchase_receipt",
        po_id: order.id,
        po_item_id: item.id,
        unit_cost: cost ? Number(cost.landedUnitCost.toFixed(4)) : null,
        note: order.po_number,
      })));

    if (moveErr) {
      // Already received. Not an error -- the point of the constraint.
      if (moveErr.code === UNIQUE_VIOLATION) { result.alreadyReceived++; continue; }
      throw moveErr;
    }
    result.received++;

    // The landed cost of the goods just received becomes the cost of record.
    // Wrapped because a store that has not run supabase/sales.sql has no such
    // table, and a missing cost must never block a receipt.
    if (cost) {
      try {
        await sb.from("product_costs").upsert({
          product_id: productId,
          cost_price: Number(cost.landedUnitCost.toFixed(2)),
          note: `PO ${order.po_number}`,
          updated_at: new Date().toISOString(),
        }, { onConflict: "product_id" });
      } catch { /* costs are optional; the dashboard reports coverage */ }
    }
  }

  // The catalog changed, so the storefront's cached product lists must go.
  if (result.received > 0 || result.productsCreated > 0) {
    updateTag(CACHE_TAGS.products);
  }
  // Both sets of screens read what this wrote. Revalidating a path nothing
  // is rendering costs nothing, and getting it wrong leaves a seller
  // looking at a stock count from before their delivery.
  revalidatePath("/admin/procurement", "layout");
  revalidatePath("/admin/stock");
  revalidatePath("/admin");
  revalidatePath("/admin/products");
  revalidatePath("/admin/sales/costs");
  if (sellerId) revalidatePath("/seller", "layout");

  return result;
}

/* ---------------------------------------------------------------------------
 * The product type, and the answers that came with it
 * ------------------------------------------------------------------------ */

type Item = PurchaseOrder["items"] extends (infer I)[] | undefined ? I : never;

/** Writes the line's product type and its answers onto a product this
 * receipt has just created.
 *
 * VALIDATED AGAIN, against the type, on the way in. savePurchaseOrder
 * already refused anything that did not fit -- so this cannot normally
 * fail -- but months can pass between an order being placed and the goods
 * landing, and an attribute can be retired from a product type in between.
 * Re-reading the type is what stops a stale answer becoming a row nothing
 * will ever show or be able to explain.
 *
 * A REFUSAL IS NOT A FAILED RECEIPT. The goods are on the shelf; a
 * specification that could not be written is a listing to finish, not a
 * delivery to reject. So this swallows its own errors, deliberately, and
 * says why here.
 */
async function applyTaxonomy(
  productId: string, item: Item, attrsOf: AttrsOf
): Promise<void> {
  const typeId = (item.product_type_id || "").trim();
  if (!typeId) return;

  const sb = supabaseAdmin();
  try {
    const attrs = await attrsOf(typeId);
    /* THE PRODUCT KEEPS WHAT IS TRUE OF ALL OF IT.
       Size and Colour are variant axes: the line says S, but the product
       is S, M and L, and writing "Size: S" onto the product would print
       exactly that in the Specifications panel of a shirt sold in three
       sizes. Those answers belong to the VARIANT the line creates -- see
       ensureVariant -- and everything else, the composition and the
       neck type and the brand, is true of the product and goes here. */
    const shared = attrs.filter((a) => !a.is_variant);
    const result = validateAttributeValues(
      shared, submittedFrom(item.attribute_values, shared.map((a) => a.id)));

    /* The TYPE goes on even when the answers do not. A product that knows
       what kind of thing it is draws the right form the moment somebody
       opens it, and every question is then in front of them. A product
       that does not know is a name and a price. */
    const { error } = await sb.from("products")
      .update({ product_type_id: typeId }).eq("id", productId);
    // The migration window: products.product_type_id arrives with
    // supabase/taxonomy.sql. Nothing else here can work without it either.
    if (error) { if (isMissingColumnError(error, "product_type_id")) return; throw error; }

    if (result.ok && result.rows.length) {
      await sb.from("product_attribute_values").insert(
        result.rows.map((r) => ({ product_id: productId, ...r })));
    }
  } catch {
    /* No taxonomy tables yet, or a type retired since the order. The
       product exists, the stock is about to land, and the listing can be
       finished by hand -- which is exactly where every product was before
       any of this. */
  }
}

/** The same, for a product that already existed: only when it has no type
 * of its own. See the note at the call site -- replacing a type deletes
 * every answer under the old one. */
async function fillBlankTaxonomy(
  productId: string, item: Item, attrsOf: AttrsOf
): Promise<void> {
  if (!(item.product_type_id || "").trim()) return;
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("products").select("product_type_id").eq("id", productId).maybeSingle();
    if (error || !data) return;
    if ((data as { product_type_id?: string | null }).product_type_id) return;
    await applyTaxonomy(productId, item, attrsOf);
  } catch { /* migration window, as above */ }
}

type AttrsOf = (typeId: string) => Promise<FormAttribute[]>;

/** Adds one size to a product's list, if it is not already there.
 *
 * Read-then-write rather than an array append in SQL, because the order
 * matters -- S before M before L is a sequence somebody chose and sorting
 * it would scramble it -- and because the comparison has to be the same
 * one parseSizes makes, so "41,5" and "41.5" are not both added.
 *
 * Swallows its own errors: a product whose size list could not be extended
 * still has the stock, and the size is on the ledger either way. */
/** Drops a product's price to `price` when that is lower than what it has.
 *
 * Never raises it: the first line already set the price, and every later
 * line of the same product is a second opinion that can only be allowed to
 * make the card more honest, not less. */
async function lowerPriceTo(productId: string, price: number): Promise<void> {
  if (!Number.isFinite(price) || price <= 0) return;
  try {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("products").select("price").eq("id", productId).maybeSingle();
    const now = Number((data as { price?: number } | null)?.price ?? 0);
    if (now > 0 && now <= price) return;
    await sb.from("products").update({ price }).eq("id", productId);
  } catch { /* the variants carry their own prices regardless */ }
}

async function addSize(productId: string, size: string): Promise<void> {
  try {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("products").select("sizes").eq("id", productId).maybeSingle();
    const have = ((data as { sizes?: string[] } | null)?.sizes ?? []).filter(Boolean);
    const merged = parseSizes([...have, size].join(", "));
    if (merged.length === have.length) return;
    await sb.from("products").update({ sizes: merged }).eq("id", productId);
  } catch { /* the size is on the ledger regardless */ }
}

/* ---------------------------------------------------------------------------
 * The variant a line buys
 * ------------------------------------------------------------------------ */

export interface LineVariant {
  id: string;
  /** "S / Black" -- what the order line and the stock report show. */
  label: string;
  /** The line's answer to the attribute whose slug is `size`, or "".
   *
   * The ledger has carried a size column since supabase/size-stock.sql and
   * the per-size views and the reorder report read it, so a variant
   * receipt that left it empty would move that stock into the "no size
   * recorded" pool, which backs every size. */
  size: string;
}

/** The variant this line buys, created if the product does not have it yet.
 *
 * Returns null when the line names no variant axis at all -- a fridge, or a
 * product type nobody has given one. Such a line receives exactly as it did
 * before any of this existed.
 *
 * FOUND BY LABEL, not created blindly: `product_variants` is unique on
 * (product_id, label), so a second purchase order buying more Black / M
 * has to top up the row that already exists. Its price and cost are left
 * alone on that path -- the shop may have set them deliberately, and a
 * restock is not a repricing.
 */
async function ensureVariant(
  productId: string, item: Item, attrsOf: AttrsOf, landedCost: number | null
): Promise<LineVariant | null> {
  const typeId = (item.product_type_id || "").trim();
  if (!typeId) return null;

  try {
    const attrs = await attrsOf(typeId);
    const stored = item.attribute_values ?? {};
    /* The axes, in the product type's own order, and only the ones this
       line actually answered. buildMatrix labels a combination the same
       way -- "Black / M" -- so a variant generated here and one generated
       by the product form's editor are the same row, not two. */
    const axes = attrs
      .filter((a) => a.is_variant)
      .map((a) => ({ attr: a, value: (stored[a.id] ?? [])[0] ?? "" }))
      .filter((a) => a.value !== "");
    if (!axes.length) return null;

    const label = axes.map((a) => a.value).join(" / ");
    const size = axes.find((a) => a.attr.slug === "size")?.value ?? "";
    const sb = supabaseAdmin();

    const { data: found } = await sb
      .from("product_variants").select("id")
      .eq("product_id", productId).eq("label", label).maybeSingle();
    if (found) return { id: (found as { id: string }).id, label, size };

    const { data: made, error } = await sb
      .from("product_variants")
      .insert({
        product_id: productId,
        label,
        /* THE LINE'S OWN SELLING PRICE. This is the whole reason a line is
           one SKU: a 45 sells for more than a 38, and the product's single
           price could not say so. Null when the buyer did not state one,
           which means "as the product" -- see supabase/variants.sql. */
        price: item.sell_price == null ? null : Number(item.sell_price),
        cost_price: landedCost,
        status: "active",
      })
      .select("id")
      .single();
    if (error) throw error;
    const variantId = (made as { id: string }).id;

    /* WHAT MAKES IT THAT COMBINATION. Without these rows the variant is a
       label and the storefront's picker has nothing to filter on. */
    await sb.from("variant_attribute_values").insert(
      axes.map((a) => ({
        variant_id: variantId, attribute_id: a.attr.id, value: a.value,
      })));

    return { id: variantId, label, size };
  } catch {
    /* No variant tables yet. The line still receives -- unvarianted, the
       way it did before supabase/variants.sql -- which is the same
       degradation every other read here takes. */
    return null;
  }
}

/** The purchase order number, for the caller's record of the act. */
export function receiptSummary(poNumber: string, r: ReceiptResult): string {
  return `${poNumber}: ${r.received} line(s) received, ${r.productsCreated} product(s) created`;
}
