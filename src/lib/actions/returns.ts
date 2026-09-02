"use server";
import { revalidatePath, updateTag } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "./guard";
import { CACHE_TAGS } from "@/lib/cache";
import { orderRef } from "@/lib/utils";
import { returnableQty } from "@/lib/sales";
import type { ReturnReason } from "@/lib/types";

/* Recording goods coming back.
 *
 * The stock half is the database's job: order_return_items has a trigger
 * that writes a ledger movement for every line marked fit to sell, so
 * products.qty still has exactly one writer. What belongs here is the part
 * the database cannot see cheaply -- that you cannot hand back more than
 * you bought. */

export interface ReturnLineInput {
  productId: string;
  productName: string;
  qty: number;
  /** False for damaged goods: back in the building, not on the shelf. */
  restock: boolean;
}

export interface RecordReturnInput {
  orderId: string;
  reason: ReturnReason;
  note?: string;
  refundTotal: number;
  lines: ReturnLineInput[];
}

const MAX_ATTEMPTS = 5;

export async function recordReturn(input: RecordReturnInput): Promise<string> {
  await requireAdmin();
  const sb = supabaseAdmin();

  const lines = input.lines.filter((l) => l.productId && Number(l.qty) > 0);
  if (!lines.length) throw new Error("A return needs at least one line.");

  const { data: order, error: orderErr } = await sb
    .from("orders").select("id, ref, buyer_phone, items, total")
    .eq("id", input.orderId).single();
  if (orderErr) throw orderErr;

  // What has already come back, so two returns of two out of three cannot
  // become four.
  const { data: priorReturns } = await sb
    .from("order_returns").select("id").eq("order_id", input.orderId);
  const priorIds = (priorReturns || []).map((r) => r.id as string);
  const already = new Map<string, number>();
  if (priorIds.length) {
    const { data: priorItems } = await sb
      .from("order_return_items").select("product_id, qty").in("return_id", priorIds);
    for (const it of priorItems || []) {
      const key = it.product_id as string | null;
      if (!key) continue;
      already.set(key, (already.get(key) || 0) + (Number(it.qty) || 0));
    }
  }

  const allowed = returnableQty(
    (order.items || []) as Array<{ product_id: string; qty: number }>, already);

  for (const l of lines) {
    const max = allowed.get(l.productId) ?? 0;
    if (l.qty > max) {
      throw new Error(
        `Cannot return ${l.qty} of ${l.productName || l.productId}: ${max} left on this order.`);
    }
  }

  const refund = Math.max(0, Math.round((Number(input.refundTotal) || 0) * 100) / 100);
  if (refund > Number(order.total || 0)) {
    throw new Error("A refund cannot be larger than the order.");
  }

  // The reference retries on collision rather than trusting six random
  // digits to be unique, exactly as an order reference does.
  const year = new Date().getFullYear();
  let created: { id: string; ref: string } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !created; attempt++) {
    const ref = orderRef("RET", String(order.buyer_phone || ""), year,
      Math.floor(Math.random() * 1_000_000));
    const { data, error } = await sb.from("order_returns").insert({
      order_id: input.orderId, ref, reason: input.reason,
      note: input.note || "", refund_total: refund,
      refunded_at: refund > 0 ? new Date().toISOString() : null,
    }).select("id, ref").single();
    if (!error) { created = data as { id: string; ref: string }; break; }
    // 23505 is a duplicate reference; anything else is a real failure.
    if ((error as { code?: string }).code !== "23505") throw error;
  }
  if (!created) throw new Error("Could not allocate a return reference.");

  // The trigger on this table restocks every line marked fit to sell.
  const { error: itemsErr } = await sb.from("order_return_items").insert(
    lines.map((l) => ({
      return_id: created!.id, product_id: l.productId,
      product_name: l.productName || "", qty: Math.floor(l.qty), restock: !!l.restock,
    })));
  if (itemsErr) {
    // Leave no half-return behind: without its lines the row is a refund
    // for nothing, and it would still move the order's payment status.
    await sb.from("order_returns").delete().eq("id", created.id);
    throw itemsErr;
  }

  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.products);
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/o/${input.orderId}`);
  revalidatePath("/admin/stock");
  revalidatePath("/admin/sales");
  return created.ref;
}
