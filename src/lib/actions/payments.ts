"use server";
import { headers } from "next/headers";
import { lookupOrder } from "@/lib/actions/orders";
import { startPaymentForOrder } from "@/lib/payments/service";
import { cardPaymentAvailable } from "@/lib/payments/registry";
import { rateLimit, callerKey } from "@/lib/rateLimit";

/** Buyer-facing entry point for card payment.
 *
 * Authorization is the same ref+phone gate the rest of the order dashboard
 * uses (lookupOrder) -- knowing both proves you are the buyer. Without that
 * check this would let anyone who guesses a reference open a payment
 * session against someone else's order.
 */
export async function startCardPayment(ref: string, phone: string): Promise<{ redirectUrl: string }> {
  // Opening a gateway session is a real outbound API call. Throttle it so a
  // script cannot burn through the acquirer's rate limit (or run up a
  // per-transaction cost) on our behalf.
  const limit = rateLimit(await callerKey("start-payment"), 10, 300);
  if (!limit.allowed) {
    throw new Error(`Too many payment attempts. Try again in ${limit.retryAfterSeconds}s.`);
  }

  const order = await lookupOrder(ref, phone);
  if (!order) throw new Error("Order not found");

  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  const proto = h.get("x-forwarded-proto") || "https";
  // NEXT_PUBLIC_SITE_URL is preferred: it is the one value guaranteed to be
  // the canonical public origin, whereas headers can be rewritten by any
  // proxy in front of us -- and this URL is handed to the gateway as the
  // place to send a paying customer back to.
  const origin = process.env.NEXT_PUBLIC_SITE_URL || (host ? `${proto}://${host}` : "");
  if (!origin) throw new Error("Site URL is not configured");

  const { redirectUrl } = await startPaymentForOrder(order.ref as string, origin);
  return { redirectUrl };
}

/** Lets the checkout UI ask whether to show the card option at all. */
export async function isCardPaymentAvailable(): Promise<boolean> {
  return cardPaymentAvailable();
}
