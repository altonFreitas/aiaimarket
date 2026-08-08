"use server";
import { requireAdmin } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { slugify } from "@/lib/utils";
import { revalidatePath } from "next/cache";

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
  revalidatePath("/admin/cats");
  return data;
}

export async function renameCategory(id: string, name: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("categories").update({ name, slug: slugify(name) }).eq("id", id);
  if (error) throw error;
  revalidatePath("/", "layout");
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
  revalidatePath("/admin/cats");
}
