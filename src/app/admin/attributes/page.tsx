import AttributesAdmin, { type AttributeRow } from "@/components/admin/AttributesAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSection } from "@/lib/actions/guard";

export default async function AttributesPage() {
  await requireSection("catalog.attributes");
  return <AttributesAdmin attributes={await loadAttributes()} />;
}

/* EVERY ATTRIBUTE, WITH ITS OPTIONS AND HOW WIDELY IT IS USED.
 *
 * Three queries rather than one nested select. A nested select would
 * repeat each attribute once per option -- eighteen copies of the Material
 * row for its eighteen options -- and the usage count is an aggregate a
 * nested select cannot express at all.
 *
 * 546 rows is a lot to send at once, and deliberately still one page: the
 * job here is finding a question you half-remember the name of, and a
 * search box over everything does that better than pagination. */
async function loadAttributes(): Promise<AttributeRow[]> {
  try {
    const sb = supabaseAdmin();
    const { data: attrs, error } = await sb
      .from("attributes")
      .select(`id,name,slug,field_type,unit,is_variant,filterable,
               searchable,sortable,admin_only,admin_edited`)
      .order("name");
    if (error || !attrs) return [];

    const [{ data: opts }, { data: links }] = await Promise.all([
      sb.from("attribute_options")
        .select("id,attribute_id,label,value").order("display_order"),
      sb.from("product_type_attributes").select("attribute_id"),
    ]);

    const byAttr = new Map<string, AttributeRow["options"]>();
    for (const o of (opts ?? []) as
         { id: string; attribute_id: string; label: string; value: string }[]) {
      const list = byAttr.get(o.attribute_id) ?? [];
      list.push({ id: o.id, label: o.label, value: o.value });
      byAttr.set(o.attribute_id, list);
    }

    const uses = new Map<string, number>();
    for (const l of (links ?? []) as { attribute_id: string }[]) {
      uses.set(l.attribute_id, (uses.get(l.attribute_id) ?? 0) + 1);
    }

    return (attrs as Omit<AttributeRow, "options" | "usedBy">[]).map((a) => ({
      ...a,
      options: byAttr.get(a.id) ?? [],
      usedBy: uses.get(a.id) ?? 0,
    }));
  } catch {
    // The migration window: the tables are not there yet. An empty screen
    // that still loads beats a crashed one -- see adminHeroSlides().
    return [];
  }
}
