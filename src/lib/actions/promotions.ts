"use server";
import { requireAdmin } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decodeImageDataUrl, safeFileStem } from "@/lib/uploadGuard";
import { updateTag, revalidatePath } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";

/** Homepage promo tiles — mirrors lib/actions/hero.ts closely (same upload
 * path, same reorder-by-swapping-sort_order technique) because the two are
 * the same kind of thing: an admin-managed, image-led merchandising slot.
 * Kept as a separate table rather than folding into hero_slides because a
 * promo tile always links into the catalog and always carries a badge —
 * different enough fields that a shared table would mean nullable columns
 * neither use case actually wants. */

export async function uploadPromotionImage(dataUrl: string, filenameHint: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { bytes, contentType, ext } = decodeImageDataUrl(dataUrl);
  const path = `promotions/${Date.now()}-${safeFileStem(filenameHint)}.${ext}`;
  const { error } = await sb.storage.from("product-images").upload(path, bytes, {
    contentType, upsert: false,
  });
  if (error) throw error;
  const { data } = sb.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}

export interface CreatePromotionInput {
  title: string;
  badgeLabel: string;
  imageUrl: string;
  href: string;
}

export async function createPromotion(input: CreatePromotionInput) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { count } = await sb.from("promotions").select("*", { count: "exact", head: true });
  const { error } = await sb.from("promotions").insert({
    title: input.title.trim() || "Promoção",
    badge_label: input.badgeLabel.trim(),
    image_url: input.imageUrl,
    href: input.href.trim() || "/shop",
    sort_order: (count || 0) + 1,
  });
  if (error) throw error;
  updateTag(CACHE_TAGS.promotions);
  revalidatePath("/", "layout");
  revalidatePath("/admin/promotions");
}

export async function updatePromotion(
  id: string,
  fields: Partial<Pick<CreatePromotionInput, "title" | "badgeLabel" | "href" | "imageUrl">>
) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const patch: Record<string, unknown> = {};
  if (fields.title !== undefined) patch.title = fields.title.trim() || "Promoção";
  if (fields.badgeLabel !== undefined) patch.badge_label = fields.badgeLabel.trim();
  if (fields.href !== undefined) patch.href = fields.href.trim() || "/shop";
  if (fields.imageUrl !== undefined) patch.image_url = fields.imageUrl;
  const { error } = await sb.from("promotions").update(patch).eq("id", id);
  if (error) throw error;
  updateTag(CACHE_TAGS.promotions);
  revalidatePath("/", "layout");
  revalidatePath("/admin/promotions");
}

export async function togglePromotionActive(id: string, active: boolean) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("promotions").update({ active }).eq("id", id);
  if (error) throw error;
  updateTag(CACHE_TAGS.promotions);
  revalidatePath("/", "layout");
  revalidatePath("/admin/promotions");
}

export async function deletePromotion(id: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("promotions").delete().eq("id", id);
  if (error) throw error;
  updateTag(CACHE_TAGS.promotions);
  revalidatePath("/", "layout");
  revalidatePath("/admin/promotions");
}

/** Swap sort_order with the neighbouring tile — same technique as
 * moveCategory (lib/actions/categories.ts) and moveHeroSlide (lib/actions/hero.ts). */
export async function movePromotion(id: string, direction: -1 | 1) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { data: rows } = await sb.from("promotions").select("*").order("sort_order");
  if (!rows) return;
  const i = rows.findIndex((r) => r.id === id);
  const j = i + direction;
  if (i === -1 || j < 0 || j >= rows.length) return;
  await sb.from("promotions").update({ sort_order: rows[j].sort_order }).eq("id", rows[i].id);
  await sb.from("promotions").update({ sort_order: rows[i].sort_order }).eq("id", rows[j].id);
  updateTag(CACHE_TAGS.promotions);
  revalidatePath("/", "layout");
  revalidatePath("/admin/promotions");
}
