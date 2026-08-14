"use server";
import { requireAdmin } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { slugify } from "@/lib/utils";
import { revalidatePath } from "next/cache";
import type { StockStatus } from "@/lib/types";

async function nextRef(): Promise<string> {
  const sb = supabaseAdmin();
  const { count } = await sb.from("products").select("*", { count: "exact", head: true });
  return "PRD-" + String((count || 0) + 1).padStart(4, "0");
}

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const sb = supabaseAdmin();
  let slug = base || "produtu";
  let n = 1;
  // small loop rather than a single query: product counts are tiny (§5, no scale problem here)
  while (true) {
    let q = sb.from("products").select("id").eq("slug", slug);
    if (excludeId) q = q.neq("id", excludeId);
    const { data } = await q.maybeSingle();
    if (!data) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

export interface ProductFormInput {
  id?: string;
  name: string;
  price: number;
  discount_price: number | null;
  qty: number;
  stock_status: StockStatus;
  description: string;
  category_id: string;
  sizes: string[];
  tags: string[];
  images: string[];
  pay_cod: boolean; pay_cop: boolean; pay_bank: boolean; pay_wallet: boolean; pay_fiar: boolean;
  municipality?: string; post?: string; suku?: string; landmark?: string;
}

export async function saveProduct(input: ProductFormInput) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const baseSlug = slugify(input.name);

  if (input.id) {
    const slug = await uniqueSlug(baseSlug, input.id);
    const { error } = await sb.from("products").update({
      name: input.name, slug, price: input.price, qty: input.qty,
      discount_price: input.discount_price,
      stock_status: input.stock_status, description: input.description,
      category_id: input.category_id || null, sizes: input.sizes, tags: input.tags,
      images: input.images,
      pay_cod: input.pay_cod, pay_cop: input.pay_cop, pay_bank: input.pay_bank,
      pay_wallet: input.pay_wallet, pay_fiar: input.pay_fiar,
      municipality: input.municipality || null, post: input.post || null,
      suku: input.suku || null, landmark: input.landmark || null,
    }).eq("id", input.id);
    if (error) throw error;
  } else {
    const ref = await nextRef();
    const slug = await uniqueSlug(baseSlug);
    const { error } = await sb.from("products").insert({
      ref, name: input.name, slug, price: input.price, qty: input.qty,
      discount_price: input.discount_price,
      stock_status: input.stock_status, description: input.description,
      category_id: input.category_id || null, sizes: input.sizes, tags: input.tags,
      images: input.images,
      pay_cod: input.pay_cod, pay_cop: input.pay_cop, pay_bank: input.pay_bank,
      pay_wallet: input.pay_wallet, pay_fiar: input.pay_fiar,
      municipality: input.municipality || null, post: input.post || null,
      suku: input.suku || null, landmark: input.landmark || null,
    });
    if (error) throw error;
  }
  revalidatePath("/", "layout");
  revalidatePath("/admin");
}

/** B3 — soft delete only, never a hard DELETE. */
export async function toggleArchive(id: string, archived: boolean) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("products").update({ archived }).eq("id", id);
  if (error) throw error;
  revalidatePath("/", "layout");
  revalidatePath("/admin");
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
  revalidatePath("/admin");
  return created.id as string;
}

/** B5 — quick stock cycle: In -> Low -> Out -> In, no full form. */
export async function cycleStock(id: string, current: StockStatus) {
  await requireAdmin();
  const order: StockStatus[] = ["in", "low", "out"];
  const next = order[(order.indexOf(current) + 1) % order.length];
  const sb = supabaseAdmin();
  const patch: Record<string, unknown> = { stock_status: next };
  if (next === "out") patch.qty = 0;
  const { error } = await sb.from("products").update(patch).eq("id", id);
  if (error) throw error;
  revalidatePath("/", "layout");
  revalidatePath("/admin");
  return next;
}

/** B6 — receives an already-compressed WebP data URL from the browser,
 * uploads it to Supabase Storage, returns the public URL. */
export async function uploadProductImage(dataUrl: string, filenameHint: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const base64 = dataUrl.split(",")[1];
  const bytes = Buffer.from(base64, "base64");
  const path = `products/${Date.now()}-${slugify(filenameHint || "img")}.webp`;
  const { error } = await sb.storage.from("product-images").upload(path, bytes, {
    contentType: "image/webp",
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
  revalidatePath("/admin");
}

export async function rejectProduct(id: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("products").update({ status: "rejected" }).eq("id", id);
  if (error) throw error;
  revalidatePath("/", "layout");
  revalidatePath("/admin");
}
