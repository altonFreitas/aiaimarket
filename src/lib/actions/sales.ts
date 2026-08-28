"use server";
import { requireAdmin } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

/* Admin-only writes behind the sales dashboard: unit costs, revenue targets
 * and the two fulfilment dates. Every one of these tables is service-role
 * only (see supabase/sales.sql), so requireAdmin() is the whole access
 * control -- there is no RLS policy underneath to catch a mistake here. */

const MAX_NOTE = 500;
const MAX_SCOPE_ID = 100;

function clip(v: string | undefined | null, max: number): string {
  return (v || "").trim().slice(0, max);
}

/** Rejects anything that is not a real YYYY-MM-DD calendar day. `new Date()`
 * alone is not enough: it happily accepts "2026-02-31" and rolls it forward
 * to March, which would then be compared against real dates. */
function cleanDate(v: string | undefined | null): string | null {
  const s = (v || "").trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Invalid date: ${s}`);
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new Error(`Invalid date: ${s}`);
  }
  return s;
}

function amount(v: unknown, field: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be zero or more`);
  return Math.round(n * 100) / 100;
}

/* ------------------------------- costs ------------------------------- */

/** Set or clear one product's unit cost. An empty string clears it, which
 * is not the same as setting it to zero: cleared means "we do not know",
 * and every margin panel skips the product rather than reporting it as pure
 * profit. */
export async function setProductCost(
  productId: string, costPrice: string | number | null, note?: string
): Promise<void> {
  await requireAdmin();
  const sb = supabaseAdmin();

  if (costPrice === "" || costPrice == null) {
    const { error } = await sb.from("product_costs").delete().eq("product_id", productId);
    if (error) throw error;
  } else {
    const { error } = await sb.from("product_costs").upsert({
      product_id: productId,
      cost_price: amount(costPrice, "Cost"),
      note: clip(note, MAX_NOTE),
      updated_at: new Date().toISOString(),
    }, { onConflict: "product_id" });
    if (error) throw error;
  }

  revalidatePath("/admin/sales");
  revalidatePath("/admin/stock");
  revalidatePath(`/admin/p/${productId}`);
}

/** Bulk entry from the cost table, so setting up a catalog is one save
 * rather than one round trip per product. Rows with an empty cost are
 * deleted in a single statement for the same reason. */
export async function setProductCosts(
  entries: Array<{ productId: string; costPrice: string | number | null }>
): Promise<void> {
  await requireAdmin();
  const sb = supabaseAdmin();

  const toUpsert = entries
    .filter((e) => e.costPrice !== "" && e.costPrice != null)
    .map((e) => ({
      product_id: e.productId,
      cost_price: amount(e.costPrice, "Cost"),
      updated_at: new Date().toISOString(),
    }));
  const toDelete = entries
    .filter((e) => e.costPrice === "" || e.costPrice == null)
    .map((e) => e.productId);

  if (toUpsert.length) {
    const { error } = await sb.from("product_costs")
      .upsert(toUpsert, { onConflict: "product_id" });
    if (error) throw error;
  }
  if (toDelete.length) {
    const { error } = await sb.from("product_costs").delete().in("product_id", toDelete);
    if (error) throw error;
  }

  revalidatePath("/admin/sales");
  revalidatePath("/admin/stock");
}

/* ------------------------------ targets ------------------------------ */

const SCOPES = ["global", "category", "seller", "municipality"] as const;
type Scope = (typeof SCOPES)[number];

/** '2026', '2026-Q3' or '2026-08'. Validated here as well as by the check
 * constraint, so the error the admin sees is a sentence rather than a
 * Postgres constraint name. */
function cleanPeriod(v: string): string {
  const s = (v || "").trim();
  if (!/^\d{4}(-(0[1-9]|1[0-2])|-Q[1-4])?$/.test(s)) {
    throw new Error(`Period must be 2026, 2026-Q3 or 2026-08 — got "${s}"`);
  }
  return s;
}

export async function setSalesTarget(
  period: string, amountValue: string | number,
  scope: Scope = "global", scopeId = ""
): Promise<void> {
  await requireAdmin();
  if (!SCOPES.includes(scope)) throw new Error(`Unknown target scope: ${scope}`);

  const sb = supabaseAdmin();
  const { error } = await sb.from("sales_targets").upsert({
    period: cleanPeriod(period),
    scope,
    scope_id: clip(scopeId, MAX_SCOPE_ID),
    amount: amount(amountValue, "Target"),
  }, { onConflict: "period,scope,scope_id" });
  if (error) throw error;

  revalidatePath("/admin/sales");
}

export async function deleteSalesTarget(id: string): Promise<void> {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("sales_targets").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/sales");
}

/* --------------------------- fulfilment dates --------------------------- */

/** The promised delivery day. Everything the dashboard says about lateness
 * derives from this one field, so an order without it is reported as
 * "no date promised" rather than counted as on time. */
export async function setExpectedDelivery(
  orderId: string, date: string | null
): Promise<void> {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("orders")
    .update({ expected_delivery: cleanDate(date) }).eq("id", orderId);
  if (error) throw error;
  revalidatePath("/admin/sales");
  revalidatePath(`/admin/o/${orderId}`);
  revalidatePath("/admin/orders");
}

/** Correct a delivery date the status trigger stamped automatically -- an
 * order marked delivered on Monday that actually arrived on Saturday. */
export async function setDeliveredAt(
  orderId: string, date: string | null
): Promise<void> {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("orders")
    .update({ delivered_at: cleanDate(date) }).eq("id", orderId);
  if (error) throw error;
  revalidatePath("/admin/sales");
  revalidatePath(`/admin/o/${orderId}`);
}
