import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkSchema, type FeatureStatus, type SchemaSnapshot } from "@/lib/schemaHealth";

/* Reads what the database actually has, via a function installed by
 * supabase/schema-health.sql.
 *
 * information_schema is not reachable over PostgREST, so this needs a
 * function of its own. It returns names only -- no data, no row counts --
 * and is granted to nobody but the service role, which is the key this
 * admin screen already holds.
 *
 * If that function is not installed the screen says so rather than
 * pretending everything is fine, because "I cannot tell" and "all good"
 * are the two answers that must never look alike here. */
export async function schemaStatus(): Promise<
  { ok: true; features: FeatureStatus[] } | { ok: false; reason: string }
> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.rpc("schema_inventory");
    if (error) return { ok: false, reason: error.message || "schema_inventory failed" };

    const rows = (data as Array<{ table_name: string; column_name: string }>) || [];
    if (!rows.length) return { ok: false, reason: "schema_inventory returned nothing" };

    const snapshot: SchemaSnapshot = {
      tables: new Set(rows.map((r) => r.table_name.toLowerCase())),
      columns: new Set(rows.map((r) => `${r.table_name}.${r.column_name}`.toLowerCase())),
    };
    return { ok: true, features: checkSchema(snapshot) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "unreachable" };
  }
}
