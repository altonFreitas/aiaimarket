import "server-only";
import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { PurchaseOrder, PurchaseOrderItem, StockMovement, Supplier } from "@/lib/types";
import type { OnOrderFact, ReceiptFact } from "@/lib/stockReport";

/* Same reasoning as the caps in lib/data/admin.ts: procurement genuinely
 * wants the whole book to compute year-on-year trends, but an unbounded read
 * is one busy year away from timing out the page that reports on it. */
const MAX_POS = 5000;
const MAX_SUPPLIERS = 2000;

/** True once supabase/procurement.sql has been run. Everything else in here
 * returns empty rather than throwing, so the dashboard can say "procurement
 * is not set up yet" instead of rendering a crash. */
export async function procurementReady(): Promise<boolean> {
  try {
    const sb = supabaseAdmin();
    const { error } = await sb.from("suppliers").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

export async function adminSuppliers(): Promise<Supplier[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("suppliers").select("*")
      .order("name").limit(MAX_SUPPLIERS);
    if (error) return [];
    return (data as Supplier[]) || [];
  } catch { return []; }
}

/** Purchase orders with their line items, newest first.
 *
 * One query with a nested select rather than a query per order: the totals,
 * the category split and the product analysis all need the lines, and
 * fetching them per row would be an N+1 across the entire purchasing book. */
/* Deduped per request, same reason as adminOrders(): Home reads the
 * purchase book for the to-do list and again for the overview. */
export const adminPurchaseOrders = cache(async (): Promise<PurchaseOrder[]> => {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("purchase_orders")
      .select("*, items:purchase_order_items(*)")
      .order("order_date", { ascending: false })
      .limit(MAX_POS);
    if (error) return [];
    return (data as PurchaseOrder[]) || [];
  } catch { return []; }
});

export async function adminPurchaseOrder(id: string): Promise<PurchaseOrder | null> {
  try {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("purchase_orders")
      .select("*, items:purchase_order_items(*)")
      .eq("id", id)
      .maybeSingle();
    return (data as PurchaseOrder) || null;
  } catch { return null; }
}

export interface ProcurementData {
  ready: boolean;
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
}

export async function adminProcurementData(): Promise<ProcurementData> {
  const ready = await procurementReady();
  if (!ready) return { ready: false, suppliers: [], purchaseOrders: [] };
  const [suppliers, purchaseOrders] = await Promise.all([
    adminSuppliers(), adminPurchaseOrders(),
  ]);
  return { ready: true, suppliers, purchaseOrders };
}

export type { PurchaseOrderItem };

/* ---------------------------------------------------------------------------
 * Receipt ledger, for the stock screen.
 * ------------------------------------------------------------------------ */

const MAX_MOVEMENTS = 20_000;

/** True once supabase/stock-receipt.sql has been run. */
export async function stockLedgerReady(): Promise<boolean> {
  try {
    const sb = supabaseAdmin();
    const { error } = await sb.from("stock_movements").select("id").limit(1);
    return !error;
  } catch { return false; }
}

/** Every purchase receipt, with the supplier it came from.
 *
 * Returns empty rather than throwing when the ledger table does not exist,
 * so the stock screen degrades to its pre-purchasing self instead of
 * breaking. */
export async function adminReceipts(): Promise<ReceiptFact[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("stock_movements")
      .select("product_id, delta, unit_cost, created_at, po:purchase_orders(supplier_id)")
      .eq("reason", "purchase_receipt")
      .order("created_at", { ascending: false })
      .limit(MAX_MOVEMENTS);
    if (error || !data) return [];

    const suppliers = await adminSuppliers();
    const nameById = new Map(suppliers.map((s) => [s.id, s.name]));

    return (data as unknown as Array<{
      product_id: string; delta: number; unit_cost: number | null;
      created_at: string; po: { supplier_id: string } | null;
    }>).map((r) => ({
      product_id: r.product_id,
      delta: Number(r.delta),
      unit_cost: r.unit_cost == null ? null : Number(r.unit_cost),
      created_at: r.created_at,
      supplier: r.po ? nameById.get(r.po.supplier_id) ?? null : null,
    }));
  } catch { return []; }
}

/** Units on purchase orders that are placed but not yet received.
 *
 * "Open" excludes draft (not committed to yet), cancelled, and received
 * (already on the shelf, and counted in onHand -- adding them here would
 * show the same goods twice). */
const OPEN_PO_STATUSES = [
  "approved", "sent", "confirmed", "in_production", "in_transit", "arrived",
];

export async function adminOnOrder(): Promise<OnOrderFact[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("purchase_order_items")
      .select("product_id, qty, po:purchase_orders!inner(status)")
      .not("product_id", "is", null)
      .limit(MAX_MOVEMENTS);
    if (error || !data) return [];

    return (data as unknown as Array<{
      product_id: string; qty: number; po: { status: string } | null;
    }>)
      .filter((r) => r.po && OPEN_PO_STATUSES.includes(r.po.status))
      .map((r) => ({ product_id: r.product_id, qty: Math.floor(Number(r.qty) || 0) }));
  } catch { return []; }
}

/** Every movement for the stock screen's drill-down, newest first.
 *
 * The whole ledger rather than one product's: the screen already holds every
 * product in memory, and one query beats one per row opened. Capped like
 * every other admin read -- a store past the cap loses its oldest history
 * from the drill-down, never its balance, which lives in products.qty. */
export async function adminStockMovements(): Promise<StockMovement[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("stock_movements")
      .select("id, product_id, delta, reason, po_id, po_item_id, order_id, unit_cost, note, created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_MOVEMENTS);
    if (error || !data) return [];
    return data as unknown as StockMovement[];
  } catch { return []; }
}

/** Products whose balance and ledger disagree.
 *
 * Empty is the healthy answer and the normal one. Anything here means
 * something wrote products.qty without leaving a movement, which after
 * supabase/stock-ledger.sql should be impossible -- so a row is worth
 * showing rather than swallowing. Returns empty when the view does not
 * exist, i.e. when that file has not been run yet. */
export async function adminStockDrift(): Promise<Array<{ product_id: string; drift: number }>> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("stock_reconciliation")
      .select("product_id, drift")
      .neq("drift", 0)
      .limit(500);
    if (error || !data) return [];
    return data as Array<{ product_id: string; drift: number }>;
  } catch { return []; }
}

/** Who last supplied each product, with their stated lead time.
 *
 * "Last" rather than "cheapest" or "usual": the reorder plan needs a lead
 * time and a name to put on a draft order, and the most recent supplier is
 * the one whose terms still apply. Products never bought through a purchase
 * order are simply absent -- the plan falls back to an assumed lead time and
 * says that it did. */
export async function supplierByProduct(): Promise<
  Map<string, { id: string; name: string; leadDays: number | null }>
> {
  const out = new Map<string, { id: string; name: string; leadDays: number | null }>();
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("stock_movements")
      .select("product_id, created_at, po:purchase_orders(supplier_id)")
      .eq("reason", "purchase_receipt")
      .order("created_at", { ascending: false })
      .limit(MAX_MOVEMENTS);
    if (error || !data) return out;

    const suppliers = await adminSuppliers();
    const byId = new Map(suppliers.map((s) => [s.id, s]));

    // Newest first, so the first row seen for a product is its latest.
    for (const r of data as unknown as Array<{
      product_id: string; po: { supplier_id: string } | null;
    }>) {
      if (!r.po || out.has(r.product_id)) continue;
      const sup = byId.get(r.po.supplier_id);
      if (!sup) continue;
      out.set(r.product_id, {
        id: sup.id, name: sup.name,
        leadDays: sup.lead_time_days == null ? null : Number(sup.lead_time_days),
      });
    }
  } catch { /* no ledger yet: every product falls back to an assumed lead time */ }
  return out;
}
