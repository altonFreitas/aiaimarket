"use server";
import { requireAdmin } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decodeImageDataUrl, safeFileStem } from "@/lib/uploadGuard";
import { revalidatePath, updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";
import { videoExtFor } from "@/lib/videoTypes";
import { writeTolerating } from "@/lib/missingColumn";
import type { HeroSlide } from "@/lib/types";

/** Reuses the same public "product-images" storage bucket as product
 * photos (see uploadProductImage in lib/actions/products.ts) rather than
 * creating a second bucket + policy set for what's still just "an image
 * the admin uploaded" -- just under a different path prefix. */
export async function uploadHeroImage(dataUrl: string, filenameHint: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { bytes, contentType, ext } = decodeImageDataUrl(dataUrl);
  const path = `hero/${Date.now()}-${safeFileStem(filenameHint)}.${ext}`;
  const { error } = await sb.storage.from("product-images").upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
  const { data } = sb.storage.from("product-images").getPublicUrl(path);
  return data.publicUrl;
}

/** A hard ceiling on a hero video. Not a technical limit -- a promise to
 * the visitor: this store is used on mobile data in Timor-Leste, and a
 * 200 MB banner would spend somebody's credit before they saw a product. */
const MAX_VIDEO_MB = 25;

/** A one-time permission to upload ONE file to ONE path in Storage.
 *
 * WHY NOT A SERVER ACTION LIKE THE PHOTOS. Every other upload here arrives
 * as a base64 data URL in the action's arguments -- fine for a 200 KB
 * photo, impossible for a video: the payload of a Server Action travels in
 * the request body, which is capped in the megabytes, and base64 makes any
 * file a third larger before it even sets off. So the server does not carry
 * the bytes at all. It checks who is asking, decides the path, and hands
 * back a token the browser uploads directly with (see HeroSlidesAdmin).
 *
 * The type and size come from the browser and are therefore claims, not
 * facts -- which is exactly why the token is scoped to a single path this
 * function chose. The worst a lying client achieves is a wrong-sized file
 * in a hero/ key it was already allowed to write. The bucket's own file
 * size limit is the second half of this, and is set in Supabase, not here.
 */
export async function createHeroVideoUpload(
  filenameHint: string, contentType: string, sizeBytes: number
): Promise<{ path: string; token: string; publicUrl: string }> {
  await requireAdmin();
  const ext = videoExtFor(contentType, filenameHint);
  if (!ext) throw new Error("Unsupported video format — use MP4, WebM or MOV");
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_VIDEO_MB * 1024 * 1024) {
    throw new Error(`Video is too large (max ${MAX_VIDEO_MB} MB)`);
  }
  const sb = supabaseAdmin();
  const path = `hero/${Date.now()}-${safeFileStem(filenameHint)}.${ext}`;
  const { data, error } = await sb.storage.from("product-images").createSignedUploadUrl(path);
  if (error) throw error;
  const { data: pub } = sb.storage.from("product-images").getPublicUrl(path);
  return { path, token: data.token, publicUrl: pub.publicUrl };
}

/** A new slide. `imageUrl` is the photo, or on a video slide the poster
 * frame -- which may be "" when the admin has not uploaded one, in which
 * case the slide simply starts dark and fills in as the video loads. */
export async function createHeroSlide(imageUrl: string, videoUrl = ""): Promise<HeroSlide> {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { count } = await sb.from("hero_slides").select("*", { count: "exact", head: true });
  const { data, error } = await sb
    .from("hero_slides")
    .insert({
      image_url: imageUrl,
      // Left out entirely when there is no video, so this still works on a
      // database that has not run supabase/hero-video.sql -- inserting a
      // column that does not exist fails the whole insert, and a shop
      // uploading a photo should not be stopped by a migration it does not
      // need yet.
      ...(videoUrl ? { video_url: videoUrl } : {}),
      sort_order: (count || 0) + 1,
    })
    .select()
    .single();
  if (error) throw error;
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.hero);
  revalidatePath("/admin/hero");
  return data as HeroSlide;
}

export async function updateHeroSlide(
  id: string,
  fields: Partial<Pick<HeroSlide,
    "headline" | "subtext" | "cta_label" | "cta_href" | "image_url" | "video_url" | "media_fit">>
) {
  await requireAdmin();
  const sb = supabaseAdmin();
  /* media_fit arrived with a later revision of supabase/hero-video.sql, so
     a shop running this code against a database it has not migrated yet
     has no such column -- and Postgres fails the WHOLE update when one is
     named: `column "media_fit" of relation "hero_slides" does not exist`.
     That would break Save for every slide over a field nobody on that shop
     can even see. Same treatment the product form gives `audience`: try
     it, and if the column is what the database objects to, save everything
     else and drop that one. */
  const { media_fit, ...always } = fields;
  const { error } = await writeTolerating(
    media_fit === undefined ? {} : { media_fit },
    (extra) => sb.from("hero_slides").update({ ...always, ...extra }).eq("id", id),
  );
  if (error) throw error;
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.hero);
  revalidatePath("/admin/hero");
}

export async function deleteHeroSlide(id: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("hero_slides").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.hero);
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
  updateTag(CACHE_TAGS.hero);
  revalidatePath("/admin/hero");
}
