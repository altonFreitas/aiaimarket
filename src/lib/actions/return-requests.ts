"use server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "./guard";
import { audit } from "@/lib/audit";
import { lookupOrder } from "./orders";
import { recordReturn } from "./returns";
import { orderRef, phoneNorm, phoneOk } from "@/lib/utils";
import { returnableQty } from "@/lib/sales";
import { rateLimit, callerKey } from "@/lib/rateLimit";
import type { Order, OrderItem, ReturnReason } from "@/lib/types";
import { returnWindow } from "@/lib/returnWindow";
import { adminSettings } from "@/lib/data/admin";

/* A BUYER ASKING TO SEND SOMETHING BACK.
 *
 * Every return in this shop began with a phone call. The admin machinery
 * was all there -- over-return prevention, restock into the ledger, a
 * settlement queue that refuses to claim money moved before it did -- and
 * unreachable by the person the goods belong to.
 *
 * A REQUEST IS NOT A RETURN. It moves no stock and refunds nothing, and
 * it can be declined. Approving one calls the same recordReturn() an admin
 * has always called, so this adds a way IN rather than a second way to do
 * the thing.
 *
 * Gated by ref + phone, the same proof the rest of /o/[ref] already runs
 * on. Nothing here is a new trust decision.
 */

const MAX_NOTE = 1000;
const MAX_LINES = 50;
const MAX_ATTEMPTS = 5;

const REASONS: readonly ReturnReason[] = [
  "damaged", "wrong_item", "not_as_described", "changed_mind", "other",
];

export interface ReturnRequestLine {
  productId: string;
  productName: string;
  qty: number;
}

/** True when this database has the table. A shop that has not run
 * supabase/return-requests.sql gets the tracking page it always had, with
 * no broken button on it. */
export async function returnRequestsAvailable(): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin()
      .from("return_requests").select("id").limit(1);
    return !error;
  } catch { return false; }
}

/** What a buyer may still send back, per product.
 *
 * Nets off what has already come back AND what an open request has already
 * claimed -- otherwise somebody could open a request for all three, then
 * another for all three, and only the admin approving the second would
 * discover it. */
export async function returnableForBuyer(
  ref: string, phone: string,
): Promise<Record<string, number>> {
  const order = await lookupOrder(ref, phone);
  if (!order) return {};

  const sb = supabaseAdmin();
  const items = ((order.items || []) as OrderItem[]).map((i) => ({
    product_id: i.product_id, qty: i.qty,
  }));

  const claimed = new Map<string, number>();

  // Already returned.
  const { data: priorReturns } = await sb
    .from("order_returns").select("id").eq("order_id", order.id);
  const priorIds = (priorReturns || []).map((r) => r.id as string);
  if (priorIds.length) {
    const { data: priorItems } = await sb
      .from("order_return_items").select("product_id, qty").in("return_id", priorIds);
    for (const it of priorItems || []) {
      const id = it.product_id as string | null;
      if (id) claimed.set(id, (claimed.get(id) || 0) + (Number(it.qty) || 0));
    }
  }

  // Already asked for and not yet answered.
  try {
    const { data: open } = await sb
      .from("return_requests").select("id").eq("order_id", order.id).eq("status", "open");
    const openIds = (open || []).map((r) => r.id as string);
    if (openIds.length) {
      const { data: openItems } = await sb
        .from("return_request_items").select("product_id, qty").in("request_id", openIds);
      for (const it of openItems || []) {
        const id = it.product_id as string | null;
        if (id) claimed.set(id, (claimed.get(id) || 0) + (Number(it.qty) || 0));
      }
    }
  } catch { /* table not there yet; the returns above still net correctly */ }

  return Object.fromEntries(returnableQty(items, claimed));
}

export async function requestReturn(input: {
  ref: string;
  phone: string;
  reason: ReturnReason;
  note?: string;
  lines: ReturnRequestLine[];
}): Promise<string> {
  if (!phoneOk(input.phone)) throw new Error("Order not found");
  if (!REASONS.includes(input.reason)) throw new Error("Choose a reason for the return");

  // Unauthenticated and it writes. Same shape of endpoint as placeOrder,
  // and the same treatment.
  const limit = await rateLimit(await callerKey("return-request"), 5, 600);
  if (!limit.allowed) {
    throw new Error(`Too many requests from this connection. Try again in ${limit.retryAfterSeconds}s.`);
  }

  const order = await lookupOrder(input.ref, input.phone);
  if (!order) throw new Error("Order not found");

  // Nothing to send back before it has arrived, and nothing to send back
  // from an order that never happened.
  if (!["arrived", "completed"].includes(order.status as string)) {
    throw new Error("You can ask to return items once the order has arrived.");
  }

  /* AND NOT FOR EVER AFTERWARDS.
   *
   * Enforced HERE as well as hidden in the form, because hiding a button
   * is not a rule: this endpoint is unauthenticated and takes a ref and a
   * phone number, so anything the browser can be persuaded to send, it
   * will send. The window is the shop's own published one -- the Returns
   * page has always promised a deadline that nothing enforced. */
  const winSettings = await adminSettings().catch(() => null);
  const win = returnWindow(order as unknown as Order, winSettings);
  if (!win.open) {
    throw new Error(
      `Returns close ${win.days} days after an order is placed. This one is past that.`);
  }

  const lines = input.lines
    .filter((l) => l.productId && Number(l.qty) > 0)
    .slice(0, MAX_LINES);
  if (!lines.length) throw new Error("Choose at least one item to send back.");

  // RE-CHECKED SERVER-SIDE, never trusted from the form. The quantities the
  // browser offered came from the same function, but a request does not
  // have to come from that browser.
  const allowed = await returnableForBuyer(input.ref, input.phone);
  for (const l of lines) {
    const max = allowed[l.productId] ?? 0;
    if (Math.floor(l.qty) > max) {
      throw new Error(
        max > 0
          ? `You can send back at most ${max} of "${l.productName}".`
          : `"${l.productName}" has already been sent back.`);
    }
  }

  const sb = supabaseAdmin();
  const year = new Date().getFullYear();
  const normalizedPhone = phoneNorm(input.phone);

  let created: { id: string; ref: string } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const ref = orderRef("RRQ", normalizedPhone, year, Math.random() * 1_000_000);
    const { data, error } = await sb.from("return_requests").insert({
      order_id: order.id,
      ref,
      reason: input.reason,
      note: (input.note || "").trim().slice(0, MAX_NOTE),
    }).select("id, ref").single();
    if (!error) { created = data as { id: string; ref: string }; break; }

    const code = (error as { code?: string }).code;
    // 23505 on the one-open-per-order index means they already have one
    // waiting. That is not an error to show as a failure -- it is the
    // answer to "can I ask again", and the answer is that they already did.
    if (code === "23505") {
      const { data: existing } = await sb
        .from("return_requests").select("ref")
        .eq("order_id", order.id).eq("status", "open").maybeSingle();
      if (existing?.ref) return existing.ref as string;
    }
    if (code !== "23505") throw error;
  }
  if (!created) throw new Error("Could not open a return request. Please try again.");

  const { error: itemsErr } = await sb.from("return_request_items").insert(
    lines.map((l) => ({
      request_id: created!.id,
      product_id: l.productId,
      product_name: (l.productName || "").slice(0, 200),
      qty: Math.floor(l.qty),
    })));
  if (itemsErr) {
    // A request with no lines is a request for nothing, and it would hold
    // the one-open-per-order slot against a buyer who could then not ask
    // again.
    await sb.from("return_requests").delete().eq("id", created.id);
    throw itemsErr;
  }

  await sb.from("order_log").insert({
    order_id: order.id,
    text: `Kliente husu fila sasán (${created.ref}): ${input.reason}`,
  });

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  return created.ref;
}

/** A buyer changing their mind about changing their mind. */
export async function withdrawReturnRequest(ref: string, phone: string): Promise<void> {
  const order = await lookupOrder(ref, phone);
  if (!order) throw new Error("Order not found");
  const sb = supabaseAdmin();
  await sb.from("return_requests")
    .update({ status: "cancelled", decided_at: new Date().toISOString() })
    .eq("order_id", order.id).eq("status", "open");
  await sb.from("order_log").insert({
    order_id: order.id, text: "Kliente hasai pedidu fila sasán",
  });
  revalidatePath("/admin/orders");
}

/* ---------------------------------------------------------------------------
 * The admin's side
 * ------------------------------------------------------------------------ */

/** Turn a request into a real return.
 *
 * THE REFUND FIGURE IS THE SHOP'S TO SET, not the buyer's. A buyer says
 * what they are sending back; what that is worth depends on the delivery
 * fee, on whether the goods came back saleable, and on whatever was agreed
 * at the counter. So the amount is a parameter here and the request never
 * carried one.
 *
 * Same for restock: only somebody who has seen the parcel can say whether
 * what is inside it can be sold again. */
export async function approveReturnRequest(input: {
  requestId: string;
  refundTotal: number;
  /** Per product. Absent means "not fit to sell", the safer default. */
  restock: Record<string, boolean>;
}): Promise<string> {
  const actor = await requireAdmin();
  const sb = supabaseAdmin();

  const { data: req } = await sb
    .from("return_requests")
    .select("id, ref, order_id, reason, note, status")
    .eq("id", input.requestId).maybeSingle();
  if (!req) throw new Error("That request no longer exists.");
  if (req.status !== "open") throw new Error("That request has already been answered.");

  const { data: items } = await sb
    .from("return_request_items").select("product_id, product_name, qty")
    .eq("request_id", req.id);
  const lines = (items || []).map((i) => ({
    productId: i.product_id as string,
    productName: (i.product_name as string) || "",
    qty: Number(i.qty) || 0,
    restock: !!input.restock[i.product_id as string],
  })).filter((l) => l.productId && l.qty > 0);
  if (!lines.length) throw new Error("That request has no lines to return.");

  // THE SAME FUNCTION AN ADMIN HAS ALWAYS CALLED. Over-return prevention,
  // the ledger trigger and the settlement queue all come along with it,
  // and none of them had to learn that requests exist.
  const returnRef = await recordReturn({
    orderId: req.order_id as string,
    reason: req.reason as ReturnReason,
    note: (req.note as string) || "",
    refundTotal: input.refundTotal,
    lines,
  });

  const { data: made } = await sb
    .from("order_returns").select("id").eq("ref", returnRef).maybeSingle();

  await sb.from("return_requests").update({
    status: "approved",
    decided_at: new Date().toISOString(),
    decided_by: actor.label,
    return_id: made?.id ?? null,
  }).eq("id", req.id);

  await audit(actor, {
    action: "return_request.approve", entity: "return_request", entityId: req.id,
    summary: `${actor.label} approved ${req.ref} as return ${returnRef}`,
    meta: { requestRef: req.ref, returnRef, refundTotal: input.refundTotal },
  });

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  return returnRef;
}

export async function declineReturnRequest(
  requestId: string, decisionNote: string,
): Promise<void> {
  const actor = await requireAdmin();
  // A decline with no reason teaches somebody that the button does nothing.
  const note = (decisionNote || "").trim().slice(0, MAX_NOTE);
  if (!note) throw new Error("Say why, so the buyer knows what happened.");

  const sb = supabaseAdmin();
  const { data: req } = await sb
    .from("return_requests").select("id, ref, order_id, status")
    .eq("id", requestId).maybeSingle();
  if (!req) throw new Error("That request no longer exists.");
  if (req.status !== "open") throw new Error("That request has already been answered.");

  const { error } = await sb.from("return_requests").update({
    status: "declined",
    decided_at: new Date().toISOString(),
    decided_by: actor.label,
    decision_note: note,
  }).eq("id", requestId).eq("status", "open");
  if (error) throw error;

  await sb.from("order_log").insert({
    order_id: req.order_id as string,
    text: `Pedidu fila sasán ${req.ref} la simu: ${note}`,
  });

  await audit(actor, {
    action: "return_request.decline", entity: "return_request", entityId: requestId,
    summary: `${actor.label} declined ${req.ref}`,
    meta: { requestRef: req.ref, note },
  });

  revalidatePath("/admin/orders");
  revalidatePath("/admin");
}

/** How many are waiting on somebody, for the home page's list. */
export async function openReturnRequestCount(): Promise<number> {
  try {
    const { count, error } = await supabaseAdmin()
      .from("return_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "open");
    if (error) return 0;
    return count ?? 0;
  } catch { return 0; }
}
