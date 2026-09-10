"use server";
import { requireAdmin } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { applyReceipt, receiptSummary, type ReceiptResult } from "@/lib/receiving";
import { audit } from "@/lib/audit";

export type { ReceiptResult };

/** Apply a purchase order's resale lines to stock, the catalog and costs.
 *
 * Called when an order reaches "received". Safe to call again: lines already
 * received are reported rather than re-applied.
 *
 * The mechanism is lib/receiving.ts, shared with a seller receiving their
 * own order. What this adds is the guard and the record: the stock ledger
 * already carries every line, and this carries the ACT -- one person
 * deciding a delivery had arrived, which is what all of those movements
 * hang off. A seller's receipt writes no audit row, because audit_log is
 * the owner's record of the owner's staff; the ledger rows, which carry the
 * purchase order number, are what say a seller's delivery landed. */
export async function receivePurchaseOrder(poId: string): Promise<ReceiptResult> {
  const actor = await requireAdmin();
  const result = await applyReceipt(poId, null);

  const { data: po } = await supabaseAdmin()
    .from("purchase_orders").select("po_number").eq("id", poId).maybeSingle();

  await audit(actor, {
    action: "po.receive", entity: "purchase_order", entityId: poId,
    summary: receiptSummary(String(po?.po_number || ""), result),
    meta: {
      poNumber: po?.po_number ?? null, received: result.received,
      alreadyReceived: result.alreadyReceived, skipped: result.skipped,
      productsCreated: result.productsCreated,
    },
  });
  return result;
}
