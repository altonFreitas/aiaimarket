"use server";
import { requireAdmin } from "./guard";
import { queueProductAlerts } from "@/lib/notify/announce";
import { writeTolerating } from "@/lib/missingColumn";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { slugify } from "@/lib/utils";
import { decodeImageDataUrl, safeFileStem } from "@/lib/uploadGuard";
import { revalidatePath, updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";
import { setStock } from "./stock";
import { audit, change } from "@/lib/audit";

async function nextRef(): Promise<string> {
  const sb = supabaseAdmin();
  // Was: count() + 1. That is wrong twice over — it reuses a number as
  // soon as anything is ever removed, and two products saved in the same
  // second both compute the same ref, so the second insert dies on the
  // UNIQUE constraint. Read the highest existing ref instead, and retry on
  // the (now genuinely rare) race.
  const { data } = await sb
    .from("products")
    .select("ref")
    .like("ref", "PRD-%")
    .order("ref", { ascending: false })
    .limit(1)
    .maybeSingle();

  const highest = data?.ref ? parseInt(String(data.ref).slice(4), 10) : 0;
  let n = (Number.isFinite(highest) ? highest : 0) + 1;

  for (let attempt = 0; attempt < 25; attempt++, n++) {
    const ref = "PRD-" + String(n).padStart(4, "0");
    const { data: clash } = await sb.from("products").select("id").eq("ref", ref).maybeSingle();
    if (!clash) return ref;
  }
  throw new Error("Could not generate a unique product reference — please try again");
}

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const sb = supabaseAdmin();
  let slug = base || "produtu";
  let n = 1;
  // small loop rather than a single query: product counts are tiny (§5, no scale problem here)
  // Was `while (true)`. A single unexpected query error inside the loop
  // (or a slug that somehow never resolves) spins a serverless function
  // until its timeout, billing for every second of it. Bounded instead.
  for (let attempt = 0; attempt < 200; attempt++) {
    let q = sb.from("products").select("id").eq("slug", slug);
    if (excludeId) q = q.neq("id", excludeId);
    const { data } = await q.maybeSingle();
    if (!data) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
  throw new Error("Could not build a unique slug for this product — try a different name");
}

export interface ProductFormInput {
  id?: string;
  name: string;
  price: number;
  discount_price: number | null;
  /** The count on the shelf. Recorded as a ledger adjustment, not written
   * over the balance -- and the only thing that decides stock_status, which
   * the database derives and nobody types. */
  qty: number;
  preorder_enabled?: boolean;
  preorder_eta?: string | null;
  /** Whether shoppers may see it.
   *
   * true -> "approved", false -> "pending", which is the storefront's own
   * gate (see getLiveProducts). A product created by a purchase order
   * receipt lands pending, because a delivery is the start of a listing
   * and not the whole of it -- the stock is real, the photograph and the
   * words are not there yet.
   *
   * Absent leaves the status ALONE on an edit, so a caller that does not
   * know about this cannot silently publish or unpublish anything. */
  onSale?: boolean;
  description: string;
  /** The ticked one-liners, already split. Optional: a caller that does
   * not know about them (a purchase-order receipt) leaves the ones a
   * listing already has alone rather than clearing them. */
  highlights?: string[];
  category_id: string;
  sizes: string[];
  tags: string[];
  /** men | women | unisex, or null for "the question does not apply". */
  /** Which store sells this. Empty string or absent means the marketplace's
   * own catalogue, which is stored as the platform's seller id rather than
   * as null -- the column has been NOT NULL since schema.sql, and the
   * storefront's "Sold by" line is drawn by looking the id up among the
   * approved sellers and finding nothing. */
  seller_id?: string | null;
  images: string[];
  pay_cod: boolean; pay_cop: boolean; pay_bank: boolean; pay_wallet: boolean; pay_fiar: boolean;
  municipality?: string; post?: string; suku?: string; landmark?: string;
}

/** Turns whatever the form chose into a seller id the column will accept.
 *
 * "" / undefined -> the marketplace's own id, from settings.seller_id --
 * the same value current_seller_id() gives a row that names no seller, so
 * an owner-listed product is identical whether it was created before this
 * select existed or after it.
 *
 * Anything else is checked against the sellers table before it is written.
 * The action is admin-only, so this is not a permission check; it is what
 * stops a stale tab, a copied id or a renamed store from filing a product
 * under a seller that does not exist, where it would sell with no "Sold
 * by" line and pay commission to nobody. Only APPROVED stores are
 * accepted, because approved is exactly the set the storefront will
 * resolve a name for. */
async function resolveSellerId(
  sb: ReturnType<typeof supabaseAdmin>, chosen: string | null | undefined
): Promise<string> {
  const platform = await sb.from("settings").select("seller_id").eq("id", 1).single();
  const own = platform.data?.seller_id as string | undefined;
  const want = (chosen || "").trim();
  if (!want || want === own) {
    if (!own) throw new Error("The store's own seller id is missing from settings.");
    return own;
  }
  const { data } = await sb
    .from("sellers").select("id").eq("id", want).eq("status", "approved").maybeSingle();
  if (!data) throw new Error("That seller is not an approved store.");
  return data.id as string;
}

/** The shop's own name, for a message that has to say who is texting.
 *
 * Falls back to nothing rather than to a placeholder: "Loja" in a text from
 * a shop called something else is worse than a message that just names the
 * product. */
async function storeName(sb: ReturnType<typeof supabaseAdmin>): Promise<string> {
  try {
    const { data } = await sb.from("settings").select("store_name").eq("id", 1).maybeSingle();
    return String(data?.store_name || "").trim();
  } catch { return ""; }
}

/* Returns the product's id, which the caller needs to write the dynamic
 * attributes against it -- a new product's id is not known until this has
 * run. Previously void; returning a value breaks no existing caller. */
export async function saveProduct(input: ProductFormInput): Promise<string> {
  const actor = await requireAdmin();

  /* THE PRICE RULES, ON THE SERVER.
   *
   * They existed only in the form. The column allows price >= 0, so a save
   * that skipped the form -- a stale tab, a second window, anything calling
   * this action directly -- could list a product at nothing, and a shop
   * finds that out when somebody buys twenty.
   *
   * Refused rather than corrected: a price of 0 is either a mistake or a
   * giveaway, and guessing which one on the shop's behalf is worse than
   * saying no. */
  const price = Number(input.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("A product needs a price above zero.");
  }
  const discount = input.discount_price == null ? null : Number(input.discount_price);
  if (discount != null && (!Number.isFinite(discount) || discount <= 0 || discount >= price)) {
    throw new Error("A discount price must be above zero and below the normal price.");
  }

  const sb = supabaseAdmin();
  const baseSlug = slugify(input.name);
  // Resolved before either branch writes, so an unknown store fails the
  // save outright rather than half-way through -- a product created and
  // then found to be unassignable would already hold a ref number.
  const sellerId = await resolveSellerId(sb, input.seller_id);

  let savedId = input.id ?? "";

  if (input.id) {
    const slug = await uniqueSlug(baseSlug, input.id);
    // Only the price is worth a record. Recording every field would bury
    // the one edit anybody ever asks about later -- "who put this on sale"
    // -- under a stream of description tweaks.
    const { data: was } = await sb
      .from("products").select("name, price, discount_price, status, archived")
      .eq("id", input.id).maybeSingle();
    // qty and stock_status are deliberately absent from this patch. The
    // quantity moves through the ledger below, and the status is derived
    // from the quantity by the database. Writing either here would put the
    // balance and its history out of step -- which is what this form used
    // to do every time it was saved.
    const { error } = await writeTolerating(
      {
        // From supabase/preorders.sql, and once written among the columns
        // that always exist -- so a shop with this code and without that
        // file could not save a product at all, over two fields its form
        // does not even show. Named here instead, where a database that
        // lacks the column drops them and keeps the save.
        preorder_enabled: input.preorder_enabled ?? true,
        preorder_eta: input.preorder_eta || null,
        /* From supabase/product-highlights.sql, and the same bargain:
           named out here so a database without the column drops it and
           keeps the save. Only when the caller sent some -- spreading
           nothing leaves what the listing already had, so a receipt
           cannot wipe the words somebody wrote. */
        ...(input.highlights === undefined ? {} : { highlights: input.highlights }),
      },
      (extra) => sb.from("products").update({
        name: input.name, slug, price, seller_id: sellerId,
        /* Only when the caller said. Spreading nothing leaves whatever
           the product had, which is what keeps a caller that does not
           know about this from publishing something by accident. */
        ...(input.onSale === undefined
          ? {} : { status: input.onSale ? "approved" : "pending" }),
        discount_price: discount,
        description: input.description,
        category_id: input.category_id || null, sizes: input.sizes, tags: input.tags,
        images: input.images,
        pay_cod: input.pay_cod, pay_cop: input.pay_cop, pay_bank: input.pay_bank,
        pay_wallet: input.pay_wallet, pay_fiar: input.pay_fiar,
        municipality: input.municipality || null, post: input.post || null,
        suku: input.suku || null, landmark: input.landmark || null,
        ...extra,
      }).eq("id", input.id)
    );
    if (error) throw error;

    /* A PRICE THAT HAS JUST BEEN CUT, announced once.
     *
     * Only when there was no discount before and there is one now: an
     * existing sale price being adjusted is not news, and a shop that
     * tweaks a sale three times must not tell everybody three times. The
     * unique index in customer-alerts.sql makes the second attempt a no-op
     * anyway; this is what stops it even being tried. */
    const hadDiscount = was?.discount_price != null && Number(was.discount_price) > 0;
    if (!hadDiscount && discount != null) {
      await queueProductAlerts(
        {
          id: input.id, name: input.name, slug, price, discount_price: discount,
          /* What the row will BE after this save, not what it was: the same
             save can publish a draft and cut its price, and announcing
             against the old status would either skip the message or send it
             about a page that is still hidden. */
          status: input.onSale === undefined
            ? (was?.status as string | undefined) ?? null
            : (input.onSale ? "approved" : "pending"),
          archived: (was?.archived as boolean | undefined) ?? false,
        },
        "discount", await storeName(sb));
    }

    if (was && (Number(was.price) !== Number(input.price)
        || Number(was.discount_price ?? 0) !== Number(input.discount_price ?? 0))) {
      await audit(actor, {
        action: "product.price", entity: "product", entityId: input.id,
        summary: `${was.name}: price ${change(was.price, input.price)}` +
          (Number(was.discount_price ?? 0) !== Number(input.discount_price ?? 0)
            ? `, discount ${change(was.discount_price ?? "none", input.discount_price ?? "none")}`
            : ""),
        meta: {
          priceFrom: Number(was.price), priceTo: Number(input.price),
          discountFrom: was.discount_price ?? null, discountTo: input.discount_price ?? null,
        },
      });
    }

    // A counted shelf, recorded as what it is: an adjustment, with a
    // reason, that anyone can find later.
    await setStock(input.id, input.qty, "counted on the product form");
  } else {
    const ref = await nextRef();
    const slug = await uniqueSlug(baseSlug);
    // Created empty and stocked by a movement, so a product's history
    // starts at its first unit rather than at some number that was already
    // there when the ledger began.
    const { data: made, error } = await writeTolerating<{ id: string }>(
      {
        // As above: from supabase/preorders.sql, so not every database has
        // them, and naming one the database lacks fails the whole insert.
        preorder_enabled: input.preorder_enabled ?? true,
        preorder_eta: input.preorder_eta || null,
        // As above, from supabase/product-highlights.sql.
        ...(input.highlights === undefined ? {} : { highlights: input.highlights }),
      },
      (extra) => sb.from("products").insert({
        ref, name: input.name, slug, price, qty: 0, seller_id: sellerId,
        /* Approved unless told otherwise: somebody filling in this form
           is making a listing on purpose. A receipt is the other door and
           it sets pending itself -- see lib/receiving.ts. */
        status: input.onSale === false ? "pending" : "approved",
        discount_price: discount,
        stock_status: "out", description: input.description,
        category_id: input.category_id || null, sizes: input.sizes, tags: input.tags,
        images: input.images,
        pay_cod: input.pay_cod, pay_cop: input.pay_cop, pay_bank: input.pay_bank,
        pay_wallet: input.pay_wallet, pay_fiar: input.pay_fiar,
        municipality: input.municipality || null, post: input.post || null,
        suku: input.suku || null, landmark: input.landmark || null,
        ...extra,
      }).select("id").single()
    );
    if (error) throw error;
    // The insert asked for the id back, so a success without one means the
    // row is not there and stocking it would write against nothing.
    if (!made) throw new Error("The product was not created.");
    savedId = made.id;

    if (input.qty) {
      await setStock(made.id, input.qty, "opening balance", "correction");
    }

    /* A NEW PRODUCT, ANNOUNCED ONCE, to the customers who asked to hear.
     *
     * After the stock, so the link in the message leads to something that
     * can be bought rather than to "out of stock" -- a shop announcing its
     * own empty shelf is worse than saying nothing.
     *
     * Queued, not necessarily sent: with no messaging gateway configured
     * the rows wait for the admin, exactly as order notifications do, so
     * this cannot start spending money on its own. queueProductAlerts
     * never throws -- a broken message queue must not stop a shop adding a
     * product. */
    await queueProductAlerts(
      {
        id: made.id, name: input.name, slug, price, discount_price: discount,
        /* THE SAME EXPRESSION AS THE INSERT ABOVE, and it has to stay that
           way: a product saved as a draft used to be announced anyway, so
           the message linked to a page the public cannot open. */
        status: input.onSale === false ? "pending" : "approved",
        archived: false,
      },
      "new_product", await storeName(sb));
  }
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.products);
  revalidatePath("/admin");
  revalidatePath("/admin/products");
  return savedId;
}

/** B3 — soft delete only, never a hard DELETE. */
export async function toggleArchive(id: string, archived: boolean) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("products").update({ archived }).eq("id", id);
  if (error) throw error;
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.products);
  revalidatePath("/admin");
  revalidatePath("/admin/products");
}

/** B4 — one-click duplicate into a new draft. */
export async function duplicateProduct(id: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { data: src, error: e1 } = await sb.from("products").select("*").eq("id", id).single();
  if (e1 || !src) throw e1 || new Error("Product not found");
  const ref = await nextRef();
  const name = src.name + " (kópia)";
  const slug = await uniqueSlug(slugify(name));
  const { id: _id, ref: _ref, slug: _slug, created_at: _c, views: _v, wa_clicks: _w, ...rest } = src;
  const { data: created, error: e2 } = await sb
    .from("products")
    .insert({ ...rest, ref, slug, name, views: 0, wa_clicks: 0 })
    .select()
    .single();
  if (e2) throw e2;
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.products);
  revalidatePath("/admin");
  revalidatePath("/admin/products");
  return created.id as string;
}

/** B5 — quick stock cycle: In -> Low -> Out -> In, no full form. */
/* cycleStock() used to live here. It walked in -> low -> out and set qty to
 * 0 on the way past, which made two problems: the balance changed with no
 * movement behind it, and cycling back round to "in stock" left a product
 * advertised as available with a quantity of zero. Stock status is now
 * derived from the quantity, so there is nothing to cycle. See
 * markOutOfStock() in ./stock.ts for the quick action that replaced it. */

/** B6 — receives an already-compressed WebP data URL from the browser,
 * uploads it to Supabase Storage, returns the public URL. */
export async function uploadProductImage(dataUrl: string, filenameHint: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { bytes, contentType, ext } = decodeImageDataUrl(dataUrl);
  const path = `products/${Date.now()}-${safeFileStem(filenameHint)}.${ext}`;
  const { error } = await sb.storage.from("product-images").upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
  const { data } = sb.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}

/** Phase 1 product moderation — a seller-submitted product stays
 * invisible to shoppers (see getLiveProducts/getProductBySlug) until
 * one of these is called. Products the admin creates themselves already
 * default to "approved" (see saveProduct's insert) and never need this. */
export async function approveProduct(id: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("products").update({ status: "approved" }).eq("id", id);
  if (error) throw error;
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.products);
  revalidatePath("/admin");
  revalidatePath("/admin/products");
}

export async function rejectProduct(id: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("products").update({ status: "rejected" }).eq("id", id);
  if (error) throw error;
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.products);
  revalidatePath("/admin");
  revalidatePath("/admin/products");
}
