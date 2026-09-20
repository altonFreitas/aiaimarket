"use server";
import { requireSection } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { slugify } from "@/lib/taxonomy/fieldTypes";

/* PRODUCT TYPES, AND WHICH ATTRIBUTES EACH ONE ASKS FOR.
 *
 * The join table is where the form actually comes from: adding a row to
 * product_type_attributes puts a field on every future form for that type,
 * and removing one takes it away. Nothing else has to change.
 *
 * `required` lives on the JOIN and not on the attribute, because it
 * depends on the product rather than on the question: Storage is required
 * on a smartphone and meaningless on a sofa, and it is the same attribute
 * row in both.
 */

export async function createProductType(categoryId: string, name: string) {
  await requireSection("catalog.types");
  const text = name.trim();
  if (!text) throw new Error("A product type needs a name.");
  if (!categoryId) throw new Error("Choose a category first.");

  const sb = supabaseAdmin();
  const slug = slugify(text);

  const { count } = await sb.from("product_types")
    .select("id", { count: "exact", head: true }).eq("category_id", categoryId);

  const { data, error } = await sb.from("product_types")
    .insert({ category_id: categoryId, name: text, slug, display_order: count ?? 0 })
    .select().single();
  if (error) {
    // Unique is (category_id, slug): "Chairs" under Furniture and "Chairs"
    // under Office are two different things with one name, so this only
    // fires for a genuine duplicate within one category.
    if ((error as { code?: string }).code === "23505") {
      throw new Error(`"${text}" already exists in this category.`);
    }
    throw error;
  }
  revalidatePath("/admin/types");
  return data;
}

export async function renameProductType(id: string, name: string) {
  await requireSection("catalog.types");
  const text = name.trim();
  if (!text) throw new Error("A product type needs a name.");
  const sb = supabaseAdmin();
  /* The NAME changes; the slug does not. The slug is what the seed and any
     bookmarked address key on, so renaming "Sofas" to "Couches" must not
     quietly create a second product type and orphan every product filed
     under the first. */
  const { error } = await sb.from("product_types").update({ name: text }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/types");
}

/** Hidden rather than deleted: it stops being offered on new products and
 * every product already filed under it keeps working. */
export async function setProductTypeStatus(id: string, status: "active" | "hidden") {
  await requireSection("catalog.types");
  const sb = supabaseAdmin();
  const { error } = await sb.from("product_types").update({ status }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/types");
}

export async function deleteProductType(id: string) {
  await requireSection("catalog.types");
  const sb = supabaseAdmin();

  /* REFUSED WHILE PRODUCTS POINT AT IT. The column is ON DELETE SET NULL,
     so this would not break those products -- but it would silently strip
     the type from every one of them and with it the meaning of every
     attribute value they hold, which no screen would ever explain. Hiding
     is the reversible way to retire a type. */
  const { count } = await sb.from("products")
    .select("id", { count: "exact", head: true }).eq("product_type_id", id);
  if ((count ?? 0) > 0) {
    throw new Error(
      `${count} product${count === 1 ? "" : "s"} use this type. Hide it instead.`);
  }

  const { error } = await sb.from("product_types").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/types");
}

/* ---------------------------------------------------------------------------
 * Which attributes a product type asks for
 * ------------------------------------------------------------------------ */

export async function assignAttribute(
  productTypeId: string, attributeId: string, required = false
) {
  await requireSection("catalog.types");
  const sb = supabaseAdmin();

  const { count } = await sb.from("product_type_attributes")
    .select("id", { count: "exact", head: true }).eq("product_type_id", productTypeId);

  const { error } = await sb.from("product_type_attributes").insert({
    product_type_id: productTypeId, attribute_id: attributeId,
    required, display_order: count ?? 0,
  });
  if (error) {
    // Already asked for. Not worth an error -- it is the state they wanted.
    if ((error as { code?: string }).code === "23505") return;
    throw error;
  }
  revalidatePath("/admin/types");
}

export async function setAssignmentRequired(id: string, required: boolean) {
  await requireSection("catalog.types");
  const sb = supabaseAdmin();
  const { error } = await sb.from("product_type_attributes")
    .update({ required }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/types");
}

/** Stops the product type asking for this attribute.
 *
 * Values already recorded against it are LEFT ALONE. They stop being shown
 * on the form, because the form is built from this table -- but a product
 * that recorded a Seat Height still has one, and putting the attribute
 * back brings it straight back into view. Deleting the values here would
 * make an unassign a data loss that looks like a layout change. */
export async function unassignAttribute(id: string) {
  await requireSection("catalog.types");
  const sb = supabaseAdmin();
  const { error } = await sb.from("product_type_attributes").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/types");
}

/** Moves one assignment up or down the form. */
export async function moveAssignment(id: string, direction: "up" | "down") {
  await requireSection("catalog.types");
  const sb = supabaseAdmin();

  const { data: row } = await sb.from("product_type_attributes")
    .select("id,product_type_id,display_order").eq("id", id).maybeSingle();
  if (!row) return;
  const me = row as { id: string; product_type_id: string; display_order: number };

  // The neighbour on that side, whichever order value it happens to hold.
  const q = sb.from("product_type_attributes")
    .select("id,display_order").eq("product_type_id", me.product_type_id);
  const { data: neighbours } = direction === "up"
    ? await q.lt("display_order", me.display_order).order("display_order", { ascending: false }).limit(1)
    : await q.gt("display_order", me.display_order).order("display_order").limit(1);

  const other = (neighbours ?? [])[0] as { id: string; display_order: number } | undefined;
  if (!other) return;   // Already at the end.

  await sb.from("product_type_attributes")
    .update({ display_order: other.display_order }).eq("id", me.id);
  await sb.from("product_type_attributes")
    .update({ display_order: me.display_order }).eq("id", other.id);
  revalidatePath("/admin/types");
}
