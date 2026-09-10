import "server-only";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability";
import { sendAlert } from "@/lib/alerts";
import { getProvider, defaultProviderId } from "./registry";
import { amountsMatch, toMinorUnits, type Currency } from "./money";
import { decideTransition, orderPayStatusFor, type PaymentStatus } from "./state";
import type { ProviderEvent } from "./types";

/** Server-side payment orchestration.
 *
 * Three rules are enforced here and nowhere else, so there is one place to
 * audit:
 *
 *   1. The amount charged comes from `orders.total` in the database. The
 *      client never states a price -- same rule placeOrder() already
 *      applies to basket lines.
 *   2. An order gets at most one live payment attempt. Double-clicking
 *      "Pay" reuses the open attempt instead of opening a second one.
 *   3. An order is only ever marked paid by a verified provider event or a
 *      server-to-server status check -- never by the browser coming back
 *      from the gateway, which is attacker-controllable.
 */

export interface StartPaymentResult {
  redirectUrl: string;
  paymentId: string;
}

/** Statuses that mean "this attempt is still live, reuse it". */
const REUSABLE: readonly PaymentStatus[] = ["initiated", "pending"];

export async function startPaymentForOrder(orderRef: string, returnUrlBase: string): Promise<StartPaymentResult> {
  const sb = supabaseAdmin();

  const { data: order } = await sb
    .from("orders")
    .select("id, ref, total, pay_status, status")
    .eq("ref", orderRef.trim().toUpperCase())
    .maybeSingle();

  if (!order) throw new Error("Order not found");
  if (order.pay_status === "paid") throw new Error("This order is already paid");
  if (["completed", "cancelled"].includes(order.status)) {
    throw new Error("This order is closed");
  }

  const currency: Currency = "USD";
  // Authoritative amount: the stored order total, not anything the caller
  // passed in.
  const amountMinor = toMinorUnits(Number(order.total), currency);

  const providerId = defaultProviderId();
  const provider = getProvider(providerId);
  if (!provider || !provider.isConfigured()) {
    throw new Error("Card payments are not available right now");
  }

  // Reuse a live attempt rather than minting a second one. Without this, a
  // buyer who double-taps ends up with two open authorizations against the
  // same order.
  const { data: existing } = await sb
    .from("payments")
    .select("id, status, amount_minor, redirect_url")
    .eq("order_id", order.id)
    .in("status", REUSABLE as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && existing.redirect_url && existing.amount_minor === amountMinor) {
    return { redirectUrl: existing.redirect_url as string, paymentId: existing.id as string };
  }

  const paymentId = crypto.randomUUID();
  const returnUrl = `${returnUrlBase.replace(/\/+$/, "")}/api/payments/${providerId}/return?p=${paymentId}`;

  // The row is written BEFORE the gateway is called. If the gateway
  // responds and we crash before persisting, an orphaned charge with no
  // local record is the one outcome that cannot be reconciled -- so the
  // local record always exists first.
  const { error: insertError } = await sb.from("payments").insert({
    id: paymentId,
    order_id: order.id,
    provider: providerId,
    idempotency_key: `${order.id}:${amountMinor}:${paymentId}`,
    amount_minor: amountMinor,
    currency,
    status: "initiated",
  });
  if (insertError) throw insertError;

  try {
    const session = await provider.createCheckout({
      paymentId,
      orderRef: order.ref as string,
      amountMinor,
      currency,
      description: `Order ${order.ref}`,
      returnUrl,
    });

    await sb
      .from("payments")
      .update({
        status: "pending",
        provider_ref: session.providerRef,
        redirect_url: session.redirectUrl,
        raw_event: session.raw ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentId);

    return { redirectUrl: session.redirectUrl, paymentId };
  } catch (err) {
    await sb
      .from("payments")
      .update({
        status: "failed",
        failure_reason: err instanceof Error ? err.message.slice(0, 500) : "gateway error",
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentId);
    reportError(err, { scope: "startPaymentForOrder", orderRef });
    throw new Error("Could not start the payment. Please try again.");
  }
}

export type ApplyResult =
  | { applied: true; status: PaymentStatus }
  | { applied: false; reason: string };

/**
 * Apply a provider event to a payment. The single write path for payment
 * outcomes — the webhook route and the return route both funnel through
 * here, so their behaviour cannot drift apart.
 *
 * Safe to call repeatedly with the same event: duplicates and out-of-order
 * deliveries are recognised and ignored rather than treated as errors.
 */
export async function applyProviderEvent(event: ProviderEvent): Promise<ApplyResult> {
  const sb = supabaseAdmin();

  const { data: payment } = await sb
    .from("payments")
    .select("id, order_id, status, amount_minor, currency")
    .eq("id", event.paymentId)
    .maybeSingle();

  if (!payment) return { applied: false, reason: "unknown payment" };

  // Duplicate delivery: the provider retried an event we already recorded.
  const { data: seen } = await sb
    .from("payment_events")
    .select("id")
    .eq("payment_id", payment.id)
    .eq("event_id", event.eventId)
    .maybeSingle();
  if (seen) return { applied: false, reason: "duplicate event" };

  // An amount that does not match what we asked for is never grounds to
  // mark an order paid -- it means a partial capture, an unexpected
  // conversion, or tampering. Record it and stop.
  if (event.status === "captured" && event.amountMinor != null) {
    if (!amountsMatch(payment.amount_minor as number, event.amountMinor)) {
      await sb.from("payment_events").insert({
        payment_id: payment.id, event_id: event.eventId, status: event.status, payload: event as unknown,
      });
      reportError(new Error("Payment amount mismatch"), {
        scope: "applyProviderEvent",
        paymentId: payment.id,
        expected: payment.amount_minor,
        reported: event.amountMinor,
      });
      // A capture for an amount we never asked for is either a partial
      // capture, an unexpected currency conversion, or tampering. All three
      // need a person, not a log line someone might read next week.
      void sendAlert("Loja AIAI — payment amount mismatch", [
        `Payment: ${payment.id}`,
        `Expected: ${payment.amount_minor} minor units`,
        `Gateway reported: ${event.amountMinor}`,
        "The order was NOT marked paid. Check the gateway before shipping.",
      ]);
      return { applied: false, reason: "amount mismatch — flagged for manual review" };
    }
  }

  const verdict = decideTransition(payment.status as PaymentStatus, event.status);

  // The event is journaled either way: "we received this and chose not to
  // act on it" is exactly what you need six weeks later in a dispute.
  await sb.from("payment_events").insert({
    payment_id: payment.id,
    event_id: event.eventId,
    status: event.status,
    payload: event as unknown,
  });

  if (verdict.action === "ignore") {
    return { applied: false, reason: verdict.reason };
  }

  await sb
    .from("payments")
    .update({
      status: verdict.to,
      provider_ref: event.providerRef ?? undefined,
      failure_reason: event.failureReason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payment.id);

  // Mirror onto the order's existing pay_status column, which the admin UI
  // and buyer dashboard already read. Only captured/refunded move it.
  const payStatus = orderPayStatusFor(verdict.to);
  if (payStatus !== "unpaid") {
    await sb.from("orders").update({ pay_status: payStatus }).eq("id", payment.order_id);
    await sb.from("order_log").insert({
      order_id: payment.order_id,
      text: payStatus === "paid" ? "Pagamentu simu liu kartaun" : "Pagamentu fila fali (refund)",
    });
  }

  return { applied: true, status: verdict.to };
}

/** Server-to-server confirmation, used by the browser-return route. The
 * redirect itself proves nothing; this asks the gateway directly. */
export async function confirmPaymentFromProvider(paymentId: string): Promise<ApplyResult> {
  const sb = supabaseAdmin();
  const { data: payment } = await sb
    .from("payments")
    .select("id, provider, provider_ref")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment) return { applied: false, reason: "unknown payment" };

  const provider = getProvider(payment.provider as string);
  if (!provider) return { applied: false, reason: "unknown provider" };

  const ref = (payment.provider_ref as string) || (payment.id as string);
  const event = await provider.fetchStatus(ref);
  if (!event) return { applied: false, reason: "gateway did not answer" };

  return applyProviderEvent(event);
}

/* MOVING MONEY BACK.
 *
 * Both of these ask the gateway to do something and then funnel the answer
 * through applyProviderEvent(), which is the same path a webhook takes. A
 * refund settled here is therefore recorded identically to one settled by
 * the gateway calling us back -- one state machine, one set of rules about
 * what may follow what, no second way for a payment to reach 'refunded'.
 */

export interface MoveMoneyResult {
  ok: boolean;
  /** Safe to show an admin. Never shown to a buyer. */
  reason?: string;
}

/** The card payment behind an order, if there is one that can still move. */
async function livePaymentForOrder(orderId: string) {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("payments")
    .select("id, provider, provider_ref, status, amount_minor, currency")
    .eq("order_id", orderId)
    // Ordered so the most recent live attempt wins: an order that failed a
    // card payment and then succeeded has two rows, and only one of them
    // has any money behind it.
    .in("status", ["authorized", "captured"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/** Send a buyer's money back through the gateway.
 *
 * `amountMinor` omitted refunds the whole payment, which is what a full
 * return means and what the gateway defaults to. */
export async function refundOrderPayment(
  orderId: string, amountMinor?: number,
): Promise<MoveMoneyResult> {
  const payment = await livePaymentForOrder(orderId);
  if (!payment) {
    // Not an error. Most orders in this shop are paid in cash, by transfer
    // or on credit, and for those the money moves at a counter -- there is
    // nothing to call.
    return { ok: false, reason: "This order has no card payment to refund." };
  }
  if (payment.status === "authorized") {
    return { ok: false, reason: "This payment was never captured -- void it instead." };
  }

  const provider = getProvider(payment.provider as string);
  if (!provider) return { ok: false, reason: "That payment gateway is no longer configured." };

  const ref = (payment.provider_ref as string) || (payment.id as string);
  const result = await provider.refund(ref, amountMinor);
  if (!result.ok) {
    reportError(new Error(result.reason || "refund refused"), {
      scope: "refundOrderPayment", orderId, paymentId: payment.id,
    });
    return { ok: false, reason: result.reason };
  }

  // Through the same door a webhook comes in by, so the state machine gets
  // its say and a refund recorded here looks exactly like one recorded by
  // the gateway calling us back.
  await applyProviderEvent({
    eventId: `refund:${ref}:${amountMinor ?? "all"}`,
    paymentId: ref,
    status: result.status,
    amountMinor: (payment.amount_minor as number) ?? null,
    currency: (payment.currency as string) ?? null,
    providerRef: result.providerRef ?? ref,
  });

  return { ok: true };
}

/** Release a hold that will never be captured.
 *
 * A cancelled order leaves the buyer's funds on hold until the
 * authorization expires on the acquirer's schedule -- typically seven
 * days, during which the money is neither theirs nor the shop's. */
export async function voidOrderAuthorization(orderId: string): Promise<MoveMoneyResult> {
  const payment = await livePaymentForOrder(orderId);
  if (!payment) return { ok: false, reason: "This order has no card payment to void." };
  if (payment.status !== "authorized") {
    // Capturing and then voiding is not a thing. That is a refund, and
    // saying so beats letting the gateway refuse with its own wording.
    return { ok: false, reason: "This payment was already captured -- refund it instead." };
  }

  const provider = getProvider(payment.provider as string);
  if (!provider) return { ok: false, reason: "That payment gateway is no longer configured." };

  const ref = (payment.provider_ref as string) || (payment.id as string);
  const result = await provider.voidAuthorization(ref);
  if (!result.ok) {
    reportError(new Error(result.reason || "void refused"), {
      scope: "voidOrderAuthorization", orderId, paymentId: payment.id,
    });
    return { ok: false, reason: result.reason };
  }

  await applyProviderEvent({
    eventId: `void:${ref}`,
    paymentId: ref,
    status: result.status,
    amountMinor: (payment.amount_minor as number) ?? null,
    currency: (payment.currency as string) ?? null,
    providerRef: result.providerRef ?? ref,
  });

  return { ok: true };
}
