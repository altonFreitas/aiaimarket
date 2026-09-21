import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { PurchaseOrder } from "@/lib/types";

/* A PURCHASE ORDER'S LINES, IN WORDS.
 *
 * The line stores ids -- a product type id and a map of attribute ids to
 * values -- because that is what a foreign key is for. A document somebody
 * prints, emails to a supplier or opens in Excel months later cannot carry
 * uuids: "e3b0c442… : 41,5" is not an order anybody can check goods
 * against.
 *
 * So this resolves them, once per order, on the server. Both exports read
 * it, and so does the PDF -- which is built in the browser and therefore
 * cannot look anything up for itself.
 *
 * ADMIN-ONLY ATTRIBUTES ARE INCLUDED HERE, and deliberately: unlike
 * lib/data/productSpecs.ts, which feeds a page the whole internet reads,
 * this feeds the shop's own purchasing paperwork. A supplier reference or
 * a shelf location is exactly the sort of thing the warehouse wants on the
 * sheet.
 */

export interface LineSpec {
  /** What the product type is called, or "" when the line names none. */
  typeName: string;
  /** The answers, in the order the product type asks. */
  specs: { name: string; value: string }[];
}

/** itemId -> what that line says, for every line that says anything.
 *
 * Returns an empty map rather than throwing on a database that has not run
 * supabase/po-taxonomy.sql: an order printed without a specification is the
 * order as it has always been printed. */
export async function purchaseOrderSpecs(
  po: PurchaseOrder | null
): Promise<Record<string, LineSpec>> {
  const items = po?.items ?? [];
  if (!items.length) return {};
  const typeIds = [...new Set(items
    .map((i) => (i.product_type_id || "").trim()).filter(Boolean))];
  const attrIds = [...new Set(items.flatMap((i) =>
    Object.keys(i.attribute_values ?? {})))];
  if (!typeIds.length && !attrIds.length) return {};

  try {
    const sb = supabaseAdmin();
    const [types, attrs, links] = await Promise.all([
      typeIds.length
        ? sb.from("product_types").select("id,name").in("id", typeIds)
        : Promise.resolve({ data: [] }),
      attrIds.length
        ? sb.from("attributes").select("id,name,unit").in("id", attrIds)
        : Promise.resolve({ data: [] }),
      /* The order the product type asks in, so the sheet reads the way the
         form the buyer filled in read. Without it the answers come out in
         whatever order Object.keys gives, which is insertion order -- so
         the same product type would print differently depending on which
         box somebody happened to fill first. */
      typeIds.length
        ? sb.from("product_type_attributes")
            .select("product_type_id,attribute_id,display_order")
            .in("product_type_id", typeIds)
        : Promise.resolve({ data: [] }),
    ]);

    const typeName = new Map(((types.data ?? []) as { id: string; name: string }[])
      .map((t) => [t.id, t.name]));
    const attr = new Map(((attrs.data ?? []) as
      { id: string; name: string; unit: string | null }[]).map((a) => [a.id, a]));
    const order = new Map(((links.data ?? []) as
      { product_type_id: string; attribute_id: string; display_order: number }[])
      .map((l) => [`${l.product_type_id}.${l.attribute_id}`, l.display_order]));

    const out: Record<string, LineSpec> = {};
    for (const item of items) {
      const typeId = (item.product_type_id || "").trim();
      const answers = Object.entries(item.attribute_values ?? {})
        .filter(([, v]) => Array.isArray(v) && v.length)
        .map(([id, v]) => ({
          id,
          name: attr.get(id)?.name ?? "",
          value: v.join(", ") + (attr.get(id)?.unit ? ` ${attr.get(id)!.unit}` : ""),
        }))
        /* An attribute retired from the catalogue since the order was
           placed has no row left to name it. Dropped rather than printed
           as ": 41,5", which is a line nobody can act on. */
        .filter((a) => a.name)
        .sort((a, b) =>
          (order.get(`${typeId}.${a.id}`) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(`${typeId}.${b.id}`) ?? Number.MAX_SAFE_INTEGER));

      const name = typeId ? (typeName.get(typeId) ?? "") : "";
      if (!name && !answers.length) continue;
      out[item.id] = {
        typeName: name,
        specs: answers.map(({ name: n, value }) => ({ name: n, value })),
      };
    }
    return out;
  } catch {
    // The migration window: no taxonomy tables yet.
    return {};
  }
}
