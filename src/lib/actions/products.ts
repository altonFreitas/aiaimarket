"use server";
import { requireAdmin } from "./guard";
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
  description: string;
  category_id: string;
  sizes: string[];
  tags: string[];
  images: string[];
  pay_cod: boolean; pay_cop: boolean; pay_bank: boolean; pay_wallet: boolean; pay_fiar: boolean;
  municipality?: string; post?: string; suku?: string; landmark?: string;
}

export async function saveProduct(input: ProductFormInput) {
  const actor = await requireAdmin();
  const sb = supabaseAdmin();
  const baseSlug = slugify(input.name);

  if (input.id) {
    const slug = await uniqueSlug(baseSlug, input.id);
    // Only the price is worth a record. Recording every field would bury
    // the one edit anybody ever asks about later -- "who put this on sale"
    // -- under a stream of description tweaks.
    const { data: was } = await sb
      .from("products").select("name, price, discount_price").eq("id", input.id).maybeSingle();
    // qty and stock_status are deliberately absent from this patch. The
    // quantity moves through the ledger below, and the status is derived
    // from the quantity by the database. Writing either here would put the
    // balance and its history out of step -- which is what this form used
    // to do every time it was saved.
    const { error } = await sb.from("products").update({
      name: input.name, slug, price: input.price,
      discount_price: input.discount_price,
      description: input.description,
      preorder_enabled: input.preorder_enabled ?? true,
      preorder_eta: input.preorder_eta || null,
      category_id: input.category_id || null, sizes: input.sizes, tags: input.tags,
      images: input.images,
      pay_cod: input.pay_cod, pay_cop: input.pay_cop, pay_bank: input.pay_bank,
      pay_wallet: input.pay_wallet, pay_fiar: input.pay_fiar,
      municipality: input.municipality || null, post: input.post || null,
      suku: input.suku || null, landmark: input.landmark || null,
    }).eq("id", input.id);
    if (error) throw error;

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
    const { data: made, error } = await sb.from("products").insert({
      ref, name: input.name, slug, price: input.price, qty: 0,
      discount_price: input.discount_price,
      stock_status: "out", description: input.description,
      preorder_enabled: input.preorder_enabled ?? true,
      preorder_eta: input.preorder_eta || null,
      category_id: input.category_id || null, sizes: input.sizes, tags: input.tags,
      images: input.images,
      pay_cod: input.pay_cod, pay_cop: input.pay_cop, pay_bank: input.pay_bank,
      pay_wallet: input.pay_wallet, pay_fiar: input.pay_fiar,
      municipality: input.municipality || null, post: input.post || null,
      suku: input.suku || null, landmark: input.landmark || null,
    }).select("id").single();
    if (error) throw error;

    if (input.qty) {
      await setStock(made.id, input.qty, "opening balance", "correction");
    }
  }
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.products);
  revalidatePath("/admin");
  revalidatePath("/admin/products");
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
