import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { PurchaseOrder, PurchaseOrderItem, Supplier } from "@/lib/types";

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
export async function adminPurchaseOrders(): Promise<PurchaseOrder[]> {
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
}

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
