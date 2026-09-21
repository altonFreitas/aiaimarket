import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* WHAT A PRODUCT PAGE SAYS ABOUT A PRODUCT.
 *
 * Section 13 of the rebuild brief, and its one hard rule: DO NOT SHOW AN
 * EMPTY ATTRIBUTE. A sofa's product type asks eighteen questions and a
 * particular sofa may answer eleven of them. Printing the other seven with
 * a dash beside each is not thoroughness -- it is seven rows of nothing
 * for a shopper to read past, and it makes a well-filled listing look
 * identical to a neglected one.
 *
 * So this returns only what was actually answered, in the order the
 * product type asks -- which is the order the form showed, so the shop
 * sees its own catalogue described the way it entered it.
 *
 * ADMIN-ONLY ATTRIBUTES NEVER APPEAR. A supplier reference or a shelf
 * location is for the shop, and this is the page the whole internet can
 * read. Filtered here AND refused by the row-level policy on
 * product_attribute_values, so a mistake in one is not an exposure.
 */

export interface ProductSpec {
  /** The question, as the catalogue words it. */
  name: string;
  /** The answer, already joined for a multi-value attribute. */
  value: string;
  unit: string | null;
  fieldType: string;
}

export async function productSpecs(productId: string): Promise<ProductSpec[]> {
  if (!productId) return [];
  try {
    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("product_attribute_values")
      .select(`value,
               attributes!inner (id, name, unit, field_type, admin_only)`)
      .eq("product_id", productId);
    if (error || !data) return [];

    type Row = {
      value: string;
      attributes: {
        id: string; name: string; unit: string | null;
        field_type: string; admin_only: boolean;
      };
    };
    const rows = (data as unknown as Row[])
      .filter((r) => r.attributes && !r.attributes.admin_only);
    if (!rows.length) return [];

    /* The order the product type asks in. Read separately because the
       values themselves carry no order -- they are a set, and a page that
       listed them by insertion would show the same sofa differently
       depending on which box somebody filled first. */
    const { data: p } = await sb
      .from("products").select("product_type_id").eq("id", productId).maybeSingle();
    const typeId = (p as { product_type_id?: string } | null)?.product_type_id;

    const order = new Map<string, number>();
    if (typeId) {
      const { data: links } = await sb
        .from("product_type_attributes")
        .select("attribute_id, display_order")
        .eq("product_type_id", typeId);
      for (const l of (links ?? []) as
           { attribute_id: string; display_order: number }[]) {
        order.set(l.attribute_id, l.display_order);
      }
    }

    // A multi-select answered three ways is one row on the page, not three.
    const byAttr = new Map<string, { spec: ProductSpec; values: string[] }>();
    for (const r of rows) {
      const a = r.attributes;
      const got = byAttr.get(a.id);
      if (got) { got.values.push(r.value); continue; }
      byAttr.set(a.id, {
        spec: { name: a.name, value: "", unit: a.unit, fieldType: a.field_type },
        values: [r.value],
      });
    }

    return [...byAttr.entries()]
      .sort((x, y) =>
        (order.get(x[0]) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(y[0]) ?? Number.MAX_SAFE_INTEGER))
      .map(([, v]) => ({ ...v.spec, value: present(v.spec, v.values) }));
  } catch {
    // The migration window: no attribute tables yet. A product page
    // without a specification table is the page as it has always been.
    return [];
  }
}

/** One readable answer out of however many values were stored. */
function present(spec: ProductSpec, values: string[]): string {
  if (spec.fieldType === "boolean") {
    // 'true' on a product page is a database talking to itself.
    return values[0] === "true" ? "Yes" : "No";
  }
  const joined = values.join(", ");
  return spec.unit ? `${joined} ${spec.unit}` : joined;
}
