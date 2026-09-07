"use server";
import { requireAdmin } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { slugify } from "@/lib/utils";
import { revalidatePath, updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";

/** C1 — inline category creation. Returns the existing row if the slug
 * already exists, so calling this twice by accident is harmless. */
export async function createCategory(name: string, parentId: string | null) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const slug = slugify(name);
  const { data: existing } = await sb.from("categories").select("*").eq("slug", slug).maybeSingle();
  if (existing) return existing;

  const countQ = sb.from("categories").select("*", { count: "exact", head: true });
  const { count } = parentId ? await countQ.eq("parent_id", parentId) : await countQ.is("parent_id", null);
  const { data, error } = await sb
    .from("categories")
    .insert({ name, slug, parent_id: parentId, sort_order: (count || 0) + 1 })
    .select()
    .single();
  if (error) throw error;
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.categories);
  revalidatePath("/admin/cats");
  return data;
}

export async function renameCategory(id: string, name: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("categories").update({ name, slug: slugify(name) }).eq("id", id);
  if (error) throw error;
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.categories);
  revalidatePath("/admin/cats");
}

/** C4 — merge: every product and every child category moves to the
 * target, then the source category is removed. */
export async function mergeCategory(fromId: string, toId: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error: e1 } = await sb.from("products").update({ category_id: toId }).eq("category_id", fromId);
  if (e1) throw e1;
  const { error: e2 } = await sb.from("categories").update({ parent_id: toId }).eq("parent_id", fromId);
  if (e2) throw e2;
  const { error: e3 } = await sb.from("categories").delete().eq("id", fromId);
  if (e3) throw e3;
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.categories);
  revalidatePath("/admin/cats");
}

/** Remove a category that holds nothing.
 *
 * REFUSES WHEN IT HOLDS ANYTHING, and that is the whole design. Deleting a
 * category with products in it does not delete the products -- the foreign
 * key is ON DELETE SET NULL, so they survive with category_id null, which
 * means they vanish from every category page and every menu while still
 * being live, buyable stock. Nothing on any screen would say where they
 * went. Subcategories go the same way.
 *
 * Merge already exists for a category that has contents: it moves them
 * somewhere real and then removes the empty shell. This is for the other
 * case -- a category created by mistake, or emptied deliberately -- where
 * merging into an unrelated category would be a lie about where the goods
 * were.
 *
 * Checked here rather than only in the form because the form is a
 * convenience and this is the rule. */
export async function deleteCategory(id: string) {
  await requireAdmin();
  const sb = supabaseAdmin();

  const { count: children } = await sb
    .from("categories").select("*", { count: "exact", head: true }).eq("parent_id", id);
  if (children) {
    throw new Error("This category still has subcategories. Remove or merge those first.");
  }

  const { count: held } = await sb
    .from("products").select("*", { count: "exact", head: true }).eq("category_id", id);
  if (held) {
    throw new Error(`This category still holds ${held} product(s). Merge it into another category instead.`);
  }

  const { error } = await sb.from("categories").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.categories);
  revalidatePath("/admin/cats");
}

/** C4 — swap sort_order with the neighbouring sibling. */
export async function moveCategory(id: string, direction: -1 | 1) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { data: cat } = await sb.from("categories").select("*").eq("id", id).single();
  if (!cat) return;
  const sibsQ = sb.from("categories").select("*").order("sort_order");
  const { data: sibs } = cat.parent_id
    ? await sibsQ.eq("parent_id", cat.parent_id)
    : await sibsQ.is("parent_id", null);
  if (!sibs) return;
  const i = sibs.findIndex((s) => s.id === id);
  const j = i + direction;
  if (j < 0 || j >= sibs.length) return;
  await sb.from("categories").update({ sort_order: sibs[j].sort_order }).eq("id", sibs[i].id);
  await sb.from("categories").update({ sort_order: sibs[i].sort_order }).eq("id", sibs[j].id);
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.categories);
  revalidatePath("/admin/cats");
}
