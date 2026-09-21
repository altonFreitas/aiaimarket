import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  TaxonomyNode, ProductType, FormAttribute, AttributeValue,
} from "@/lib/taxonomy/types";

/* READING THE TAXONOMY, ONE LEVEL AT A TIME.
 *
 * Section 24 of the brief, and the reason this file is four small
 * functions rather than one that returns everything: the specification
 * carries 267 product types and 2,568 attribute assignments, and a form
 * that loaded all of them to draw one dropdown would be sending about a
 * megabyte to ask "which category?".
 *
 * So the page loads categories. Picking one loads its subcategories.
 * Picking one of those loads its product types. Picking one of THOSE loads
 * its fourteen-to-eighteen attributes. Nothing else is ever fetched.
 *
 * EVERY FUNCTION TOLERATES THE TABLES NOT EXISTING, in the same way
 * adminHeroSlides() does: this project's SQL is pasted in by hand after
 * the code ships, so between a deploy and that paste every one of these
 * tables is absent. An admin screen that crashes in that window is worse
 * than one that shows an empty list and lets the rest of the page work.
 */

/** Top-level categories: the first dropdown. */
export async function taxonomyRoots(): Promise<TaxonomyNode[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("categories")
      .select("id,name,slug,parent_id")
      .is("parent_id", null)
      .order("sort_order");
    if (error) return [];
    return (data as TaxonomyNode[]) ?? [];
  } catch { return []; }
}

/** The product types filed under one category or subcategory.
 *
 * Takes the node the form is actually sitting on. A shop is free to file
 * product types at either depth, so this asks about ONE node rather than
 * assuming the caller means a subcategory. */
export async function productTypesOf(nodeId: string): Promise<ProductType[]> {
  if (!nodeId) return [];
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("product_types")
      .select("id,category_id,name,slug,display_order")
      .eq("category_id", nodeId)
      .eq("status", "active")
      .order("display_order");
    if (error) return [];
    return (data as ProductType[]) ?? [];
  } catch { return []; }
}

/** THE ONE THAT MAKES THE FORM DYNAMIC. Every attribute this product type
 * asks for, in its configured order, each with its options.
 *
 * Two queries rather than one nested select: the options come back as a
 * flat list and are grouped here. A nested select would repeat every
 * attribute row once per option, which for Material's eighteen options is
 * eighteen copies of the same row over the wire. */
export async function attributesForType(
  productTypeId: string, opts: { includeAdminOnly?: boolean } = {}
): Promise<FormAttribute[]> {
  if (!productTypeId) return [];
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("product_type_attributes")
      .select(`required, display_order,
               attributes!inner (
                 id, name, slug, field_type, unit, is_variant,
                 admin_only, validation
               )`)
      .eq("product_type_id", productTypeId)
      .order("display_order");
    if (error || !data) return [];

    type Row = {
      required: boolean; display_order: number;
      attributes: {
        id: string; name: string; slug: string; field_type: string;
        unit: string | null; is_variant: boolean; admin_only: boolean;
        validation: Record<string, unknown> | null;
      };
    };

    const rows = (data as unknown as Row[])
      .filter((r) => r.attributes)
      .filter((r) => opts.includeAdminOnly || !r.attributes.admin_only);
    if (!rows.length) return [];

    // The options for every attribute on this form, in one query.
    const ids = rows.map((r) => r.attributes.id);
    const { data: optRows } = await sb
      .from("attribute_options")
      .select("attribute_id,label,value,display_order")
      .in("attribute_id", ids)
      .order("display_order");

    const byAttr = new Map<string, { label: string; value: string }[]>();
    for (const o of (optRows ?? []) as
         { attribute_id: string; label: string; value: string }[]) {
      const list = byAttr.get(o.attribute_id) ?? [];
      list.push({ label: o.label, value: o.value });
      byAttr.set(o.attribute_id, list);
    }

    return rows.map((r) => ({
      id: r.attributes.id,
      name: r.attributes.name,
      slug: r.attributes.slug,
      field_type: r.attributes.field_type as FormAttribute["field_type"],
      unit: r.attributes.unit,
      is_variant: r.attributes.is_variant,
      admin_only: r.attributes.admin_only,
      required: r.required,
      display_order: r.display_order,
      validation: (r.attributes.validation ?? {}) as FormAttribute["validation"],
      options: byAttr.get(r.attributes.id) ?? [],
    }));
  } catch { return []; }
}

/** What one product has already answered, for the edit form. */
export async function attributeValuesOf(productId: string): Promise<AttributeValue[]> {
  if (!productId) return [];
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("product_attribute_values")
      .select("attribute_id,value,value_num")
      .eq("product_id", productId);
    if (error) return [];
    return (data as AttributeValue[]) ?? [];
  } catch { return []; }
}
