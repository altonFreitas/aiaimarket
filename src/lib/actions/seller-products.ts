"use server";
import { requireApprovedSeller } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { slugify } from "@/lib/utils";
import { decodeImageDataUrl, safeFileStem } from "@/lib/uploadGuard";
import { revalidatePath, updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";
import { moveStockTo } from "@/lib/stockLedger";

/* A seller's stock goes through the same ledger the admin's does.
 *
 * It did not used to. Saving a seller product wrote qty and stock_status
 * straight onto the row, and the stock button set qty to 0 the same way --
 * so products.qty moved with nothing in stock_movements to explain it,
 * every seller-owned product showed drift in stock_reconciliation, and the
 * restock alert measured against a reference the ledger had never seen.
 * See lib/stockLedger.ts for why the shared writer lives outside this file.
 */

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

export interface SellerProductFormInput {
  id?: string;
  name: string;
  price: number;
  discount_price: number | null;
  /** The count on the shelf. Recorded as a ledger adjustment, not written
   * over the balance -- and the only thing that decides stock_status, which
   * the database derives and nobody types. */
  qty: number;
  description: string;
  category_id: string;
  sizes: string[];
  tags: string[];
  images: string[];
  pay_cod: boolean; pay_cop: boolean; pay_bank: boolean; pay_wallet: boolean; pay_fiar: boolean;
}

/** Same shape as the admin saveProduct(), but seller-scoped: the seller
 * is resolved from the verified session (requireApprovedSeller()), never
 * from the client, and every update first checks the existing row's
 * seller_id actually matches — a seller can never edit another seller's
 * product by guessing/reusing an id. New listings go live immediately
 * (status="approved") — an approved seller no longer needs admin
 * sign-off per product, only the one-time seller approval itself
 * (admin can still reject/suspend a seller entirely at any point, and
 * the products.status column stays in place for that). */
export async function saveSellerProduct(input: SellerProductFormInput) {
  const seller = await requireApprovedSeller();
  const sb = supabaseAdmin();
  const baseSlug = slugify(input.name);

  if (input.id) {
    const { data: existing } = await sb.from("products").select("seller_id").eq("id", input.id).maybeSingle();
    if (!existing || existing.seller_id !== seller.id) throw new Error("Not your product");

    const slug = await uniqueSlug(baseSlug, input.id);
    // qty and stock_status are deliberately absent from this patch. The
    // quantity moves through the ledger below, and the status is derived
    // from the quantity by the database. Writing either here would put the
    // balance and its history out of step -- which is what this form used
    // to do every time it was saved.
    const { error } = await sb.from("products").update({
      name: input.name, slug, price: input.price,
      discount_price: input.discount_price,
      description: input.description,
      category_id: input.category_id || null, sizes: input.sizes, tags: input.tags,
      images: input.images,
      pay_cod: input.pay_cod, pay_cop: input.pay_cop, pay_bank: input.pay_bank,
      pay_wallet: input.pay_wallet, pay_fiar: input.pay_fiar,
    }).eq("id", input.id);
    if (error) throw error;

    // A counted shelf, recorded as what it is: an adjustment, with a
    // reason, naming the seller who counted it. The ledger's note is where
    // that name goes -- audit_log is the admin's record and its actor_kind
    // accepts owner, staff and system only.
    await moveStockTo(
      input.id, input.qty,
      `counted on the seller product form by ${seller.store_name || seller.full_name}`
    );
  } else {
    const ref = await nextRef();
    const slug = await uniqueSlug(baseSlug);
    // Created empty and stocked by a movement, so a product's history
    // starts at its first unit rather than at some number that was already
    // there when the ledger began.
    const { data: made, error } = await sb.from("products").insert({
      ref, name: input.name, slug, price: input.price, qty: 0,
      discount_price: input.discount_price,
      stock_status: "out", description: input.description,
      category_id: input.category_id || null, sizes: input.sizes, tags: input.tags,
      images: input.images,
      pay_cod: input.pay_cod, pay_cop: input.pay_cop, pay_bank: input.pay_bank,
      pay_wallet: input.pay_wallet, pay_fiar: input.pay_fiar,
      seller_id: seller.id,
      status: "approved",
    }).select("id").single();
    if (error) throw error;
    // The insert asked for the id back, so a success without one means the
    // row is not there and stocking it would write against nothing.
    if (!made) throw new Error("The product was not created.");

    if (input.qty) {
      await moveStockTo(made.id, input.qty, "opening balance", "correction");
    }
  }
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.products);
  revalidatePath("/seller/products");
}

export async function uploadSellerProductImage(dataUrl: string, filenameHint: string) {
  await requireApprovedSeller();
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

/** The quick action on the seller's product list: this shelf is empty.
 *
 * Ownership-checked, and one-way, exactly as the admin's markOutOfStock().
 * It replaced a three-way in -> low -> out cycle that was wrong twice over:
 * it set qty to 0 with no movement behind it, and cycling round to "in
 * stock" left the product advertised as available with a quantity of zero.
 * Putting a line back means saying how many, which is a count typed on the
 * product itself -- a button cannot invent the number. */
export async function markSellerProductOutOfStock(id: string): Promise<void> {
  const seller = await requireApprovedSeller();
  const sb = supabaseAdmin();
  const { data: existing } = await sb.from("products").select("seller_id").eq("id", id).maybeSingle();
  if (!existing || existing.seller_id !== seller.id) throw new Error("Not your product");

  // Nothing sets stock_status: taking the balance to zero is what makes it
  // "out", by way of apply_stock_movement().
  await moveStockTo(
    id, 0,
    `marked out of stock by ${seller.store_name || seller.full_name}`
  );

  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.products);
  revalidatePath("/seller/products");
}

/** Soft delete only (same B3 rule as admin) — ownership-checked. */
export async function toggleSellerProductArchive(id: string, archived: boolean) {
  const seller = await requireApprovedSeller();
  const sb = supabaseAdmin();
  const { data: existing } = await sb.from("products").select("seller_id").eq("id", id).maybeSingle();
  if (!existing || existing.seller_id !== seller.id) throw new Error("Not your product");

  const { error } = await sb.from("products").update({ archived }).eq("id", id);
  if (error) throw error;
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.products);
  revalidatePath("/seller/products");
}
