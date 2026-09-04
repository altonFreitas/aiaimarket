import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkSchema, snapshotFromRows, type FeatureStatus, type SchemaRow } from "@/lib/schemaHealth";

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
 * are the two answers that must never look alike here.
 *
 * The rows are folded into a snapshot by snapshotFromRows(), which is in
 * lib/schemaHealth.ts with the rest of the logic that can be tested without
 * a database -- including the part that tells the function's two return
 * shapes apart. This file is the call and nothing else.
 */

export async function schemaStatus(): Promise<
  { ok: true; features: FeatureStatus[] } | { ok: false; reason: string }
> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.rpc("schema_inventory");
    if (error) return { ok: false, reason: error.message || "schema_inventory failed" };

    const rows = (data as SchemaRow[]) || [];
    if (!rows.length) return { ok: false, reason: "schema_inventory returned nothing" };

    return { ok: true, features: checkSchema(snapshotFromRows(rows)) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "unreachable" };
  }
}
