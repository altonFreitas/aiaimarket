import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  CustomerReturnRow, SupplierReturnRow, OpenRequestRow, SupplierReturnStatus,
} from "@/lib/returns";

/* Reading what came back, in both directions.
 *
 * Every function here answers "the migration has not been run" as a distinct
 * state rather than as an empty list, for the same reason lib/data/finance.ts
 * does: a returns dashboard showing a return rate of 0% because
 * supabase/returns.sql was never applied is telling the shop its best
 * possible news on no evidence at all.
 */

const MAX_RETURNS = 5000;

export interface CustomerReturnsRead {
  ready: boolean;
  rows: CustomerReturnRow[];
  /** Requests a buyer raised that nobody has answered. Empty and ready
   * when supabase/return-requests.sql has not been run -- that half is a
   * later migration than the returns themselves. */
  openRequests: OpenRequestRow[];
  requestsReady: boolean;
}

interface RawReturn {
  id: string;
  order_id: string;
  ref: string;
  reason: string;
  note: string | null;
  refund_total: number | string | null;
  refunded_at: string | null;
  created_at: string;
  order?: { ref: string | null } | null;
  items?: Array<{
    product_id: string | null;
    product_name: string | null;
    qty: number | string;
    restock: boolean | null;
  }> | null;
}

/** Every customer return, with its lines and the order it belongs to.
 *
 * One query with the lines embedded rather than two and a join in
 * JavaScript: a return without its lines counts no units, and a screen that
 * reported a hundred returns of nothing at all would look like a bug in the
 * shop rather than in the fetch. */
export async function customerReturns(): Promise<CustomerReturnsRead> {
  const sb = supabaseAdmin();
  let rows: CustomerReturnRow[] = [];
  let ready = false;

  try {
    const { data, error } = await sb
      .from("order_returns")
      .select(`id, order_id, ref, reason, note, refund_total, refunded_at, created_at,
               order:orders(ref),
               items:order_return_items(product_id, product_name, qty, restock)`)
      .order("created_at", { ascending: false })
      .limit(MAX_RETURNS);

    if (!error) {
      ready = true;
      rows = ((data as unknown as RawReturn[]) || []).map((r) => ({
        id: r.id,
        ref: r.ref,
        orderId: r.order_id,
        orderRef: r.order?.ref || "",
        reason: r.reason,
        note: r.note || "",
        refundTotal: Number(r.refund_total) || 0,
        refundedAt: r.refunded_at,
        createdAt: r.created_at,
        lines: (r.items || []).map((l) => ({
          productId: l.product_id,
          productName: l.product_name || "",
          qty: Number(l.qty) || 0,
          // Absent means true: the column has defaulted to true since the
          // table existed, and treating a missing value as "scrapped"
          // would invent damage that was never recorded.
          restock: l.restock !== false,
        })),
      }));
    }
  } catch { /* returns.sql not run */ }

  const { openRequests, requestsReady } = await openReturnRequests();
  return { ready, rows, openRequests, requestsReady };
}

async function openReturnRequests(): Promise<{
  openRequests: OpenRequestRow[]; requestsReady: boolean;
}> {
  const sb = supabaseAdmin();
  try {
    const { data, error } = await sb
      .from("return_requests")
      .select("id, ref, reason, created_at, order:orders(ref)")
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) return { openRequests: [], requestsReady: false };
    return {
      requestsReady: true,
      openRequests: ((data as unknown as Array<{
        id: string; ref: string; reason: string; created_at: string;
        order?: { ref: string | null } | null;
      }>) || []).map((r) => ({
        id: r.id, ref: r.ref, reason: r.reason,
        orderRef: r.order?.ref || "", createdAt: r.created_at,
      })),
    };
  } catch { return { openRequests: [], requestsReady: false }; }
}

export interface SupplierReturnsRead {
  ready: boolean;
  rows: SupplierReturnRow[];
}

/** Every claim against a supplier, with its lines.
 *
 * `ready` false means supabase/supplier-returns.sql has not been run, and
 * the screen says so. It does not mean the shop has never sent anything
 * back, and the difference is the difference between a clean bill of health
 * and an unread one. */
export async function supplierReturns(): Promise<SupplierReturnsRead> {
  const sb = supabaseAdmin();
  try {
    const { data, error } = await sb
      .from("supplier_returns")
      .select(`id, ref, supplier_id, po_id, reason, status, note,
               credit_expected_usd, credit_received_usd, credited_at,
               shipped_on, created_at,
               supplier:suppliers(name), po:purchase_orders(po_number),
               items:supplier_return_items(product_id, product_name, qty, unit_cost, from_stock)`)
      .order("created_at", { ascending: false })
      .limit(MAX_RETURNS);

    if (error) return { ready: false, rows: [] };

    return {
      ready: true,
      rows: ((data as unknown as Array<Record<string, unknown>>) || []).map((r) => ({
        id: r.id as string,
        ref: r.ref as string,
        supplierId: r.supplier_id as string,
        supplierName: ((r.supplier as { name?: string } | null)?.name) || "",
        poNumber: ((r.po as { po_number?: string } | null)?.po_number) || null,
        reason: r.reason as string,
        status: r.status as SupplierReturnStatus,
        note: (r.note as string) || "",
        creditExpectedUsd: Number(r.credit_expected_usd) || 0,
        creditReceivedUsd: Number(r.credit_received_usd) || 0,
        creditedAt: (r.credited_at as string) || null,
        shippedOn: (r.shipped_on as string) || null,
        createdAt: r.created_at as string,
        lines: ((r.items as Array<Record<string, unknown>>) || []).map((l) => ({
          productId: (l.product_id as string) || null,
          productName: (l.product_name as string) || "",
          qty: Number(l.qty) || 0,
          unitCost: Number(l.unit_cost) || 0,
          fromStock: l.from_stock !== false,
        })),
      })),
    };
  } catch { return { ready: false, rows: [] }; }
}

/** How many orders the shop has taken, for the return rate's denominator.
 *
 * Cancelled orders are excluded: nothing was ever delivered, so nothing
 * could come back, and counting them would flatter the rate by padding the
 * bottom of the fraction with parcels that never left. */
export async function liveOrderCount(): Promise<number> {
  const sb = supabaseAdmin();
  try {
    const { count, error } = await sb
      .from("orders")
      .select("id", { count: "exact", head: true })
      .neq("status", "cancelled");
    if (error) return 0;
    return count || 0;
  } catch { return 0; }
}
