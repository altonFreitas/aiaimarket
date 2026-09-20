import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { landedCosts, isResaleLine, parseSizes } from "@/lib/procurement";
import { normalizeSizeQty } from "@/lib/sizeStock";
import { normalizeVariantQty, receiptMovementsFor } from "@/lib/variantStock";
import { normalizeAudience } from "@/lib/audience";
import { slugify } from "@/lib/utils";
import { revalidatePath, updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";
import type { PurchaseOrder } from "@/lib/types";

/* Receiving a purchase order: the one event that writes everything
 * downstream. For each line bought FOR RESALE it
 *
 *   1. creates the catalog product, if the line does not already point at one
 *   2. writes a stock_movements row, which the database trigger turns into
 *      stock on the product
 *   3. upserts the landed unit cost into product_costs
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

  for (const item of items) {
    if (!isResaleLine(item)) { result.skipped++; continue; }

    const cost = costByItem.get(item.id);
    // Stock is whole units even though a purchase line may be fractional
    // (3.5 metres of cloth). Round down: claiming stock you do not have is
    // worse than under-reporting it.
    const units = Math.floor(Number(item.qty) || 0);
    if (units < 1) { result.skipped++; continue; }

    let productId = item.product_id;

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
          /* WHO THE GOODS ARE FOR, from the line that bought them.
             Without this every product created by a receipt arrived
             unlabelled and had to be edited afterwards from memory -- by
             the same person who had already answered the question when
             they placed the order. Null stays null: "not said" is a real
             state and is not the same as unisex (see lib/audience.ts). */
          audience: normalizeAudience(item.audience),
          images: [],
        })
        .select("id")
        .single();
      if (createErr) throw createErr;
      productId = created.id as string;
      result.productsCreated++;

      // Point the line at what it created, so a second receipt tops up this
      // product rather than creating a duplicate.
      await sb.from("purchase_order_items")
        .update({ product_id: productId }).eq("id", item.id);
    }

    // An existing product is FILLED IN, never overwritten. Someone may
    // have written a careful description for the shop's own listing, and a
    // restock must not replace it with whatever the supplier called it.
    // Only genuinely blank fields are touched.
    else if (item.sizes || item.description || item.audience) {
      const { data: current } = await sb
        .from("products").select("sizes, description, audience")
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
        // Filled in only when the shop has not said. Someone may have
        // deliberately marked a product unisex that the supplier calls
        // men's, and a restock must not argue with them.
        const incomingAudience = normalizeAudience(item.audience);
        if (incomingAudience && !normalizeAudience(current.audience)) {
          patch.audience = incomingAudience;
        }
        if (Object.keys(patch).length) {
          await sb.from("products").update(patch).eq("id", productId);
        }
      }
    }

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
    /* WHICH SIZE EACH VARIANT IS, for the column that has not retired.
       Every movement still carries a size -- the per-size views and the
       reorder report read it -- and a variant receipt that left it empty
       would quietly move that stock into the "no size recorded" pool,
       which backs every size. Read once per line rather than once per
       movement. */
    const variantQty = normalizeVariantQty(item.variant_qty);
    const sizeByVariant = new Map<string, string>();
    const variantIds = Object.keys(variantQty);
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

/** The purchase order number, for the caller's record of the act. */
export function receiptSummary(poNumber: string, r: ReceiptResult): string {
  return `${poNumber}: ${r.received} line(s) received, ${r.productsCreated} product(s) created`;
}
