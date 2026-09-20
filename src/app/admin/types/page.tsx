import ProductTypesAdmin, {
  type TypeRow, type AttrOption,
} from "@/components/admin/ProductTypesAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSection } from "@/lib/actions/guard";

export default async function ProductTypesPage() {
  await requireSection("catalog.types");
  const { types, categories, allAttributes } = await load();
  return (
    <ProductTypesAdmin
      types={types} categories={categories} allAttributes={allAttributes} />
  );
}

async function load(): Promise<{
  types: TypeRow[];
  categories: { id: string; path: string }[];
  allAttributes: AttrOption[];
}> {
  const empty = { types: [], categories: [], allAttributes: [] };
  try {
    const sb = supabaseAdmin();

    const [{ data: cats }, { data: pts }, { data: attrs }] = await Promise.all([
      sb.from("categories").select("id,name,parent_id").order("sort_order"),
      sb.from("product_types")
        .select("id,name,slug,status,category_id").order("display_order"),
      sb.from("attributes").select("id,name,field_type").order("name"),
    ]);
    if (!pts) return empty;

    type Cat = { id: string; name: string; parent_id: string | null };
    const catById = new Map((cats ?? []).map((c) => [(c as Cat).id, c as Cat]));

    /* "Home, Furniture & Living / Furniture / Home Equipment / Living" --
       the whole path, because a bare "Clothing" appears under both Men's
       and Women's and there would be no telling them apart. */
    const pathOf = (id: string): string => {
      const c = catById.get(id);
      if (!c) return "—";
      return c.parent_id
        ? `${catById.get(c.parent_id)?.name ?? "—"} / ${c.name}`
        : c.name;
    };

    // Assignments and product counts, each in one query rather than one
    // per product type -- 267 types would otherwise be 534 round trips.
    const [{ data: links }, { data: prods }] = await Promise.all([
      sb.from("product_type_attributes")
        .select("id,product_type_id,attribute_id,required,display_order")
        .order("display_order"),
      sb.from("products").select("product_type_id").not("product_type_id", "is", null),
    ]);

    /* The column is field_type and the prop is fieldType. Mapped once,
       here, rather than letting the database's spelling leak into the
       component -- the two names are a rename away from each other and a
       silent undefined on a screen is how that gets noticed. */
    type AttrRow = { id: string; name: string; field_type: string };
    const attrById = new Map(
      (attrs ?? []).map((a) => [(a as AttrRow).id, a as AttrRow]));

    const byType = new Map<string, TypeRow["attributes"]>();
    for (const l of (links ?? []) as {
      id: string; product_type_id: string; attribute_id: string; required: boolean;
    }[]) {
      const a = attrById.get(l.attribute_id);
      if (!a) continue;
      const list = byType.get(l.product_type_id) ?? [];
      list.push({
        assignmentId: l.id, attributeId: l.attribute_id,
        name: a.name, fieldType: a.field_type, required: l.required,
      });
      byType.set(l.product_type_id, list);
    }

    const counts = new Map<string, number>();
    for (const p of (prods ?? []) as { product_type_id: string }[]) {
      counts.set(p.product_type_id, (counts.get(p.product_type_id) ?? 0) + 1);
    }

    return {
      types: (pts as { id: string; name: string; slug: string; status: string;
                       category_id: string }[]).map((t) => ({
        id: t.id, name: t.name, slug: t.slug, status: t.status,
        categoryId: t.category_id,
        categoryPath: pathOf(t.category_id),
        productCount: counts.get(t.id) ?? 0,
        attributes: byType.get(t.id) ?? [],
      })),
      categories: (cats ?? []).map((c) => ({
        id: (c as Cat).id, path: pathOf((c as Cat).id),
      })),
      allAttributes: ((attrs ?? []) as AttrRow[]).map((a) => ({
        id: a.id, name: a.name, fieldType: a.field_type,
      })),
    };
  } catch {
    return empty;
  }
}
