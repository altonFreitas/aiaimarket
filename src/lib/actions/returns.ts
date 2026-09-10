"use server";
import { revalidatePath, updateTag } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { refundOrderPayment } from "@/lib/payments/service";
import { toMinorUnits } from "@/lib/payments/money";
import { requireAdmin } from "./guard";
import { audit } from "@/lib/audit";
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
  const actor = await requireAdmin();
  const sb = supabaseAdmin();

  const lines = input.lines.filter((l) => l.productId && Number(l.qty) > 0);
  if (!lines.length) throw new Error("A return needs at least one line.");

  const { data: order, error: orderErr } = await sb
    .from("orders").select("id, ref, buyer_phone, items, total, pay_method, pay_status")
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

  /* A refund this application cannot execute.
   *
   * Only 'card' goes through a gateway; every other method in this shop is
   * money a person hands over. And only an order that was actually PAID has
   * anything to send back -- an unpaid card order that never captured has
   * nothing at the acquirer to reverse. */
  const needsGateway =
    order.pay_method === "card" &&
    ["paid", "deposit"].includes(String(order.pay_status || ""));

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
      /* WHEN THE MONEY ACTUALLY MOVED -- and for a card, that is not now.
       *
       * Cash, a bank transfer and a wallet are settled by the same person
       * recording this return, at the same counter, in the same minute, so
       * stamping it here is simply true. A card refund has to be made at
       * the acquirer, and nothing in this application can do that: the
       * PaymentProvider interface has no refund method. Claiming it anyway
       * is how an order row ends up saying the buyer was refunded while
       * their money is still with the bank.
       *
       * Left null instead, which puts the return on the admin's "refunds
       * to settle" list until somebody does it at the gateway and marks it
       * (markRefundSettled below). Only settled returns move the order's
       * payment status -- see supabase/refund-settlement.sql. */
      refunded_at: refund > 0 && !needsGateway ? new Date().toISOString() : null,
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

  // Money leaving the till, with a name against it.
  await audit(actor, {
    action: "order.refund", entity: "order", entityId: input.orderId,
    summary: `${created.ref}: ${lines.reduce((n, l) => n + l.qty, 0)} item(s) back, ` +
      `${refund.toFixed(2)} refunded (${input.reason})`,
    meta: {
      returnRef: created.ref, refund, reason: input.reason,
      lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, restock: l.restock })),
    },
  });

  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.products);
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/o/${input.orderId}`);
  revalidatePath("/admin/stock");
  revalidatePath("/admin/sales");
  return created.ref;
}

/** "I have refunded this at the gateway."
 *
 * The one thing this application cannot do for a card order, recorded by
 * the person who did it. Stamping refunded_at re-fires the trigger in
 * supabase/refund-settlement.sql, which is what finally moves the order's
 * payment status to refunded -- so the status is a consequence of the money
 * moving rather than a claim made in advance of it.
 *
 * Audited, because it is a person asserting a fact about money that the
 * system has no way to verify. */
export async function markRefundSettled(returnId: string) {
  const actor = await requireAdmin();
  const sb = supabaseAdmin();

  const { data: row } = await sb
    .from("order_returns").select("id, ref, order_id, refund_total, refunded_at")
    .eq("id", returnId).maybeSingle();
  if (!row) throw new Error("That return no longer exists.");
  if (row.refunded_at) return;   // already settled; saying so twice is not an error

  const { error } = await sb.from("order_returns")
    .update({ refunded_at: new Date().toISOString() })
    .eq("id", returnId).is("refunded_at", null);
  if (error) throw error;

  await audit(actor, {
    action: "return.refund_settled",
    entity: "order_return",
    entityId: returnId,
    summary: `${actor.label} marked ${row.ref} refunded at the gateway`,
    meta: { ref: row.ref, amount: Number(row.refund_total) || 0 },
  });

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
}

/* SETTLING IT BY ACTUALLY SENDING THE MONEY.
 *
 * markRefundSettled() above is a person ASSERTING that they went to the
 * bank portal and did it -- which was the only option while the provider
 * interface had no refund on it. This is the other option, and it should
 * be the one anybody reaches for: it asks the gateway, and only records
 * the refund if the gateway says yes.
 *
 * The manual path stays. A gateway can be down, a merchant profile can
 * refuse an API refund, and somebody may genuinely have refunded by hand
 * before this existed -- and in all three the shop still needs a way to
 * tell the truth about what happened.
 */
export async function settleRefundThroughGateway(returnId: string) {
  const actor = await requireAdmin();
  const sb = supabaseAdmin();

  const { data: row } = await sb
    .from("order_returns").select("id, ref, order_id, refund_total, refunded_at")
    .eq("id", returnId).maybeSingle();
  if (!row) throw new Error("That return no longer exists.");
  if (row.refunded_at) return;   // already settled

  const amount = Number(row.refund_total) || 0;
  if (amount <= 0) throw new Error("There is nothing to refund on that return.");

  // Minor units, because that is the only representation a gateway
  // accepts and the only one that cannot lose a cent to a float.
  const result = await refundOrderPayment(
    row.order_id as string, toMinorUnits(amount, "USD"));

  if (!result.ok) {
    // NOT stamped. The whole point of this file is that refunded_at means
    // the money moved; writing it after a refusal would put the lie back.
    await audit(actor, {
      action: "return.refund_failed", entity: "order_return", entityId: returnId,
      summary: `${row.ref}: the gateway refused the refund`,
      meta: { ref: row.ref, amount, reason: result.reason ?? null },
    });
    throw new Error(result.reason || "The gateway refused the refund.");
  }

  const { error } = await sb.from("order_returns")
    .update({ refunded_at: new Date().toISOString() })
    .eq("id", returnId).is("refunded_at", null);
  if (error) throw error;

  await audit(actor, {
    action: "return.refund_sent", entity: "order_return", entityId: returnId,
    summary: `${actor.label} refunded ${amount.toFixed(2)} for ${row.ref} through the gateway`,
    meta: { ref: row.ref, amount },
  });

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
}

/** Returns whose money has not moved yet.
 *
 * Read straight from refunded_at rather than inferred from an order's
 * pay_status, so it is right on a database that has not run
 * supabase/refund-settlement.sql too -- there the old trigger has already
 * (wrongly) marked the order refunded, and this list is the only thing that
 * still knows the truth. */
export async function pendingGatewayRefunds(): Promise<Array<{
  id: string; ref: string; orderRef: string; amount: number; createdAt: string;
}>> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("order_returns")
      .select("id, ref, refund_total, created_at, orders(ref)")
      .is("refunded_at", null).gt("refund_total", 0)
      .order("created_at", { ascending: false }).limit(200);
    if (error) return [];
    return (data || []).map((r) => ({
      id: r.id as string,
      ref: r.ref as string,
      orderRef: String((r as { orders?: { ref?: string } }).orders?.ref || ""),
      amount: Number(r.refund_total) || 0,
      createdAt: r.created_at as string,
    }));
  } catch { return []; }
}
