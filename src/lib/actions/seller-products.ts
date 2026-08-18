"use server";
import { requireApprovedSeller } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { slugify } from "@/lib/utils";
import { decodeImageDataUrl, safeFileStem } from "@/lib/uploadGuard";
import { revalidatePath } from "next/cache";
import type { StockStatus } from "@/lib/types";

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
  qty: number;
  stock_status: StockStatus;
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
    const { error } = await sb.from("products").update({
      name: input.name, slug, price: input.price, qty: input.qty,
      discount_price: input.discount_price,
      stock_status: input.stock_status, description: input.description,
      category_id: input.category_id || null, sizes: input.sizes, tags: input.tags,
      images: input.images,
      pay_cod: input.pay_cod, pay_cop: input.pay_cop, pay_bank: input.pay_bank,
      pay_wallet: input.pay_wallet, pay_fiar: input.pay_fiar,
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
      seller_id: seller.id,
      status: "approved",
    });
    if (error) throw error;
  }
  revalidatePath("/", "layout");
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

/** Quick stock cycle, mirrors admin's cycleStock but ownership-checked. */
export async function cycleSellerStock(id: string, current: StockStatus) {
  const seller = await requireApprovedSeller();
  const sb = supabaseAdmin();
  const { data: existing } = await sb.from("products").select("seller_id").eq("id", id).maybeSingle();
  if (!existing || existing.seller_id !== seller.id) throw new Error("Not your product");

  const order: StockStatus[] = ["in", "low", "out"];
  const next = order[(order.indexOf(current) + 1) % order.length];
  const patch: Record<string, unknown> = { stock_status: next };
  if (next === "out") patch.qty = 0;
  const { error } = await sb.from("products").update(patch).eq("id", id);
  if (error) throw error;
  revalidatePath("/", "layout");
  revalidatePath("/seller/products");
  return next;
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
  revalidatePath("/seller/products");
}
