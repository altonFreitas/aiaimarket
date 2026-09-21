import MigrateAdmin from "@/components/admin/MigrateAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSection } from "@/lib/actions/guard";
import { groupForMigration, type TypeCandidate } from "@/lib/taxonomy/migrate";

export default async function MigratePage() {
  await requireSection("catalog.products");
  const { groups, types, done, total } = await load();
  return <MigrateAdmin groups={groups} types={types} done={done} total={total} />;
}

async function load() {
  const empty = { groups: [], types: [], done: 0, total: 0 };
  try {
    const sb = supabaseAdmin();
    const [{ data: products }, { data: cats }, { data: pts }] = await Promise.all([
      // Archived products are left out: they are not selling, and filing
      // them is work nobody benefits from.
      sb.from("products").select("id,category_id,product_type_id").eq("archived", false),
      sb.from("categories").select("id,name,parent_id"),
      sb.from("product_types").select("id,name,category_id").eq("status", "active")
        .order("display_order"),
    ]);
    if (!products) return empty;

    type Cat = { id: string; name: string; parent_id: string | null };
    const byId = new Map(((cats ?? []) as Cat[]).map((c) => [c.id, c]));

    /* The whole path, because a bare "Clothing" appears under both Men's
       and Women's and there would be no telling them apart in a list of
       267. */
    const pathOf = (id: string): string => {
      const c = byId.get(id);
      if (!c) return "—";
      return c.parent_id
        ? `${byId.get(c.parent_id)?.name ?? "—"} / ${c.name}`
        : c.name;
    };

    const types: TypeCandidate[] = ((pts ?? []) as
      { id: string; name: string; category_id: string }[])
      .map((t) => ({ id: t.id, name: t.name, path: pathOf(t.category_id) }));

    const rows = products as
      { id: string; category_id: string | null; product_type_id: string | null }[];

    return {
      groups: groupForMigration(
        rows, ((cats ?? []) as Cat[]).map((c) => ({ id: c.id, name: c.name })), types),
      types,
      done: rows.filter((p) => p.product_type_id).length,
      total: rows.length,
    };
  } catch {
    // The migration window: no taxonomy tables yet. An empty screen that
    // loads beats a crashed one.
    return empty;
  }
}
