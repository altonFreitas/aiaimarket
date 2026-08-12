"use server";
import { requireAdmin } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { HeroSlide } from "@/lib/types";

/** Reuses the same public "product-images" storage bucket as product
 * photos (see uploadProductImage in lib/actions/products.ts) rather than
 * creating a second bucket + policy set for what's still just "an image
 * the admin uploaded" -- just under a different path prefix. */
export async function uploadHeroImage(dataUrl: string, filenameHint: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const base64 = dataUrl.split(",")[1];
  const bytes = Buffer.from(base64, "base64");
  const safeName = (filenameHint || "img").replace(/[^a-z0-9.-]/gi, "-");
  const path = `hero/${Date.now()}-${safeName}.webp`;
  const { error } = await sb.storage.from("product-images").upload(path, bytes, {
    contentType: "image/webp",
    upsert: false,
  });
  if (error) throw error;
  const { data } = sb.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}

export async function createHeroSlide(imageUrl: string): Promise<HeroSlide> {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { count } = await sb.from("hero_slides").select("*", { count: "exact", head: true });
  const { data, error } = await sb
    .from("hero_slides")
    .insert({ image_url: imageUrl, sort_order: (count || 0) + 1 })
    .select()
    .single();
  if (error) throw error;
  revalidatePath("/", "layout");
  revalidatePath("/admin/hero");
  return data as HeroSlide;
}

export async function updateHeroSlide(
  id: string,
  fields: Partial<Pick<HeroSlide, "headline" | "subtext" | "cta_label" | "cta_href" | "image_url">>
) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("hero_slides").update(fields).eq("id", id);
  if (error) throw error;
  revalidatePath("/", "layout");
  revalidatePath("/admin/hero");
}

export async function deleteHeroSlide(id: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("hero_slides").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/", "layout");
  revalidatePath("/admin/hero");
}

/** Swap sort_order with the neighbouring slide, same technique as
 * moveCategory in lib/actions/categories.ts. */
export async function moveHeroSlide(id: string, direction: -1 | 1) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { data: slides } = await sb.from("hero_slides").select("*").order("sort_order");
  if (!slides) return;
  const i = slides.findIndex((s) => s.id === id);
  const j = i + direction;
  if (i === -1 || j < 0 || j >= slides.length) return;
  await sb.from("hero_slides").update({ sort_order: slides[j].sort_order }).eq("id", slides[i].id);
  await sb.from("hero_slides").update({ sort_order: slides[i].sort_order }).eq("id", slides[j].id);
  revalidatePath("/", "layout");
  revalidatePath("/admin/hero");
}
