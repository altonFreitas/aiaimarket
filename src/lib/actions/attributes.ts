"use server";
import { requireSection } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { slugify, type FieldType } from "@/lib/taxonomy/fieldTypes";

/* THE ATTRIBUTE LIBRARY, AND WHO OWNS A ROW.
 *
 * Every write in this file sets attributes.admin_edited. That flag is the
 * agreement between this screen and the seed: taxonomy-seed.sql corrects
 * the field types it inferred each time it is pasted, EXCEPT on rows a
 * human has touched. Without the flag, either a fix shipped later never
 * reaches a shop that already ran the seed, or it arrives by trampling
 * whatever the owner changed. Forgetting to set it here is therefore not
 * a cosmetic slip -- it silently hands the row back to the generator, and
 * the owner's correction disappears the next time the SQL is pasted.
 *
 * DELETING IS THE DANGEROUS ONE. attribute_options and
 * product_attribute_values both cascade from `attributes`, so dropping
 * "Material" would take the material of every product with it, silently
 * and without a copy anywhere. So a delete counts what it would destroy
 * first and refuses when the answer is not zero. The way to retire an
 * attribute that is in use is to stop assigning it, which loses nothing.
 */

const FIELD_TYPES: readonly FieldType[] = [
  "text", "textarea", "richtext", "number", "decimal", "currency",
  "select", "multiselect", "boolean", "color", "image", "file",
  "date", "datetime", "range", "dimensions", "tags",
];

export interface AttributeInput {
  name: string;
  field_type: FieldType;
  unit?: string | null;
  is_variant?: boolean;
  filterable?: boolean;
  searchable?: boolean;
  sortable?: boolean;
  admin_only?: boolean;
  validation?: Record<string, unknown>;
}

function clean(input: AttributeInput) {
  const name = input.name.trim();
  if (!name) throw new Error("An attribute needs a name.");
  if (!FIELD_TYPES.includes(input.field_type)) {
    throw new Error(`Unknown field type: ${input.field_type}`);
  }
  return {
    name,
    field_type: input.field_type,
    // Empty string and null both mean "no unit", and storing both would
    // render as "12 " for one of them.
    unit: input.unit?.trim() || null,
    is_variant: !!input.is_variant,
    filterable: !!input.filterable,
    searchable: !!input.searchable,
    sortable: !!input.sortable,
    admin_only: !!input.admin_only,
    validation: input.validation ?? {},
  };
}

export async function createAttribute(input: AttributeInput) {
  await requireSection("catalog.attributes");
  const sb = supabaseAdmin();
  const body = clean(input);
  const slug = slugify(body.name);

  const { data: existing } = await sb
    .from("attributes").select("id,name").eq("slug", slug).maybeSingle();
  if (existing) {
    // Reuse is the point -- one "Material" shared by 174 product types --
    // so a name that already exists is not an error to report as a
    // failure, it is the row they meant.
    return existing;
  }

  const { data, error } = await sb.from("attributes")
    .insert({ ...body, slug, admin_edited: true })
    .select().single();
  if (error) throw error;
  revalidatePath("/admin/attributes");
  return data;
}

export async function updateAttribute(id: string, input: AttributeInput) {
  await requireSection("catalog.attributes");
  const sb = supabaseAdmin();
  // admin_edited, always: see the note at the top of this file.
  const { error } = await sb.from("attributes")
    .update({ ...clean(input), admin_edited: true })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/attributes");
}

/** What deleting this attribute would take with it. */
export async function attributeUsage(id: string): Promise<{
  productTypes: number; values: number;
}> {
  await requireSection("catalog.attributes");
  const sb = supabaseAdmin();
  const [types, vals] = await Promise.all([
    sb.from("product_type_attributes")
      .select("id", { count: "exact", head: true }).eq("attribute_id", id),
    sb.from("product_attribute_values")
      .select("id", { count: "exact", head: true }).eq("attribute_id", id),
  ]);
  return { productTypes: types.count ?? 0, values: vals.count ?? 0 };
}

export async function deleteAttribute(id: string) {
  await requireSection("catalog.attributes");
  const usage = await attributeUsage(id);

  /* REFUSED WHILE IT IS IN USE. Both child tables cascade, so this would
     otherwise delete the recorded value from every product holding one --
     no warning, no copy, nothing to restore from. Unassigning it from a
     product type is the reversible way to retire an attribute. */
  if (usage.values > 0) {
    throw new Error(
      `${usage.values} product${usage.values === 1 ? "" : "s"} still record this. ` +
      `Remove it from those products first.`);
  }
  if (usage.productTypes > 0) {
    throw new Error(
      `${usage.productTypes} product type${usage.productTypes === 1 ? "" : "s"} still ask for this. ` +
      `Remove it from them first.`);
  }

  const sb = supabaseAdmin();
  const { error } = await sb.from("attributes").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/attributes");
}

/* ---------------------------------------------------------------------------
 * Options
 * ------------------------------------------------------------------------ */

export async function addOption(attributeId: string, label: string) {
  await requireSection("catalog.attributes");
  const text = label.trim();
  if (!text) throw new Error("An option needs a label.");
  const sb = supabaseAdmin();

  const { count } = await sb.from("attribute_options")
    .select("id", { count: "exact", head: true }).eq("attribute_id", attributeId);

  /* Label and value the same on creation. They are separate columns so the
     shop can later rename "Black" to "Jet Black" on every product page
     without rewriting the stored value on ten thousand rows -- but making
     somebody type both to add one option would be asking them to care
     about that now. */
  const { error } = await sb.from("attribute_options").insert({
    attribute_id: attributeId, label: text, value: text,
    display_order: count ?? 0,
  });
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new Error(`"${text}" is already an option.`);
    }
    throw error;
  }
  revalidatePath("/admin/attributes");
}

/** Renames the option everywhere it is shown, without touching what is
 * stored against any product. */
export async function renameOption(id: string, label: string) {
  await requireSection("catalog.attributes");
  const text = label.trim();
  if (!text) throw new Error("An option needs a label.");
  const sb = supabaseAdmin();
  const { error } = await sb.from("attribute_options").update({ label: text }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/attributes");
}

export async function deleteOption(id: string) {
  await requireSection("catalog.attributes");
  const sb = supabaseAdmin();

  /* A PRODUCT MAY ALREADY HAVE ANSWERED THIS. Options do not cascade into
     product_attribute_values -- they are joined on the VALUE text, not by
     id -- so removing one leaves those products holding an answer that is
     no longer offered. That is survivable and visible (the edit form shows
     it as free text on a select whose options no longer include it), but
     it should be said rather than discovered. */
  const { data: opt } = await sb.from("attribute_options")
    .select("attribute_id,value").eq("id", id).maybeSingle();

  let stillUsing = 0;
  if (opt) {
    const { count } = await sb.from("product_attribute_values")
      .select("id", { count: "exact", head: true })
      .eq("attribute_id", (opt as { attribute_id: string }).attribute_id)
      .eq("value", (opt as { value: string }).value);
    stillUsing = count ?? 0;
  }

  const { error } = await sb.from("attribute_options").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/attributes");
  return { stillUsing };
}
