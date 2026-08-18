import "server-only";
import crypto from "node:crypto";
import type {
  CheckoutSession, CreateCheckoutInput, PaymentProvider, ProviderEvent, WebhookVerification,
} from "../types";
import type { PaymentStatus } from "../state";
import { formatMinorUnits, toMinorUnits } from "../money";

/* ===========================================================================
 * BNCTL / Mastercard card acquiring.
 *
 * >>> READ THIS BEFORE GOING LIVE <<<
 *
 * This adapter is written against **Mastercard Payment Gateway Services
 * (MPGS)** Hosted Checkout — the gateway product Mastercard licenses to
 * acquiring banks, which is the most common way a bank that has just joined
 * the Mastercard network exposes card acquiring to merchants. It is a
 * well-specified, widely deployed REST API, and the shape below follows it.
 *
 * It is NOT confirmed against BNCTL's own integration guide, because I do
 * not have that document. Before this processes a real transaction, get
 * BNCTL's merchant integration pack and check three things:
 *
 *   1. Gateway host + API version   (MPGS_HOST, MPGS_API_VERSION)
 *   2. The webhook authentication scheme. MPGS deployments variously use an
 *      HMAC-SHA256 over the raw body, a static shared secret header, or IP
 *      allow-listing. This file implements HMAC (the strongest of the
 *      three) with a configurable header name — verifyWebhook() below is
 *      small and self-contained precisely so it can be swapped.
 *   3. Whether your merchant profile is configured for PURCHASE (funds
 *      captured immediately) or AUTHORIZE (a hold you capture later). This
 *      adapter requests PURCHASE. If BNCTL sets you up for AUTHORIZE you
 *      will get `authorized` events and must add an explicit capture step —
 *      the state machine in ../state.ts already models that transition.
 *
 * If BNCTL turns out to use something other than MPGS, this ONE file is
 * what changes. The interface in ../types.ts, the state machine, the
 * webhook route, the database schema and the checkout UI all stay as they
 * are. That is the whole reason for the indirection.
 * ======================================================================== */

const HOST = process.env.MPGS_HOST || "";                 // e.g. https://bnctl.gateway.mastercard.com
const MERCHANT_ID = process.env.MPGS_MERCHANT_ID || "";
const API_PASSWORD = process.env.MPGS_API_PASSWORD || "";
const API_VERSION = process.env.MPGS_API_VERSION || "100";
const WEBHOOK_SECRET = process.env.MPGS_WEBHOOK_SECRET || "";
const SIGNATURE_HEADER = process.env.MPGS_SIGNATURE_HEADER || "x-notification-signature";

/** MPGS authenticates API calls with HTTP Basic, username `merchant.<id>`. */
function authHeader(): string {
  return "Basic " + Buffer.from(`merchant.${MERCHANT_ID}:${API_PASSWORD}`).toString("base64");
}

function apiBase(): string {
  return `${HOST.replace(/\/+$/, "")}/api/rest/version/${API_VERSION}/merchant/${encodeURIComponent(MERCHANT_ID)}`;
}

/** MPGS reports a coarse `result` plus a finer `status`. We map to our own
 * vocabulary rather than storing theirs, so the rest of the app never has to
 * learn a provider's spelling of "it worked". */
function mapStatus(result?: string, status?: string): PaymentStatus {
  const s = (status || "").toUpperCase();
  const r = (result || "").toUpperCase();

  if (s === "CAPTURED" || s === "PARTIALLY_CAPTURED") return "captured";
  if (s === "AUTHORIZED" || s === "PENDING_CAPTURE") return "authorized";
  if (s === "REFUNDED" || s === "PARTIALLY_REFUNDED") return "refunded";
  if (s === "CANCELLED" || s === "VOIDED" || s === "EXPIRED") return "cancelled";
  if (s === "FAILED" || s === "DECLINED") return "failed";
  if (r === "FAILURE" || r === "ERROR") return "failed";
  if (r === "SUCCESS") return "captured";
  return "pending";
}

/** Amounts come back as decimal strings ("19.99"). Parse via the shared
 * money helper so the rounding rule is the same one used on the way out. */
function parseAmount(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    return toMinorUnits(n);
  } catch {
    return null;
  }
}

function pick(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

export const mpgsProvider: PaymentProvider = {
  id: "bnctl",

  isConfigured() {
    return Boolean(HOST && MERCHANT_ID && API_PASSWORD);
  },

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    if (!this.isConfigured()) {
      throw new Error("Card payments are not configured");
    }

    // INITIATE_CHECKOUT asks the gateway for a short-lived session that the
    // hosted page is opened against. The amount is sent as a formatted
    // decimal derived from our integer minor units -- never a raw float.
    const body = {
      apiOperation: "INITIATE_CHECKOUT",
      interaction: {
        operation: "PURCHASE",
        merchant: { name: process.env.NEXT_PUBLIC_STORE_NAME || "Loja AIAI" },
        returnUrl: input.returnUrl,
        displayControl: { billingAddress: "HIDE", customerEmail: "HIDE" },
      },
      order: {
        // Our payments row id is the gateway's order id, so every gateway
        // record maps back to exactly one row here.
        id: input.paymentId,
        amount: formatMinorUnits(input.amountMinor, input.currency),
        currency: input.currency,
        description: input.description.slice(0, 127),
        reference: input.orderRef,
      },
    };

    const res = await fetch(`${apiBase()}/session`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      // Never let a hung gateway hold a serverless function open to its
      // own timeout -- fail fast and let the buyer retry.
      signal: AbortSignal.timeout(15_000),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Payment gateway rejected the request (${res.status})`);
    }

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error("Payment gateway returned an unreadable response");
    }

    const session = json.session as Record<string, unknown> | undefined;
    const sessionId = session ? pick(session, "id") : undefined;
    if (!sessionId) {
      throw new Error("Payment gateway did not return a checkout session");
    }

    return {
      // MPGS Hosted Checkout is normally opened by its own JS embed; the
      // `checkoutUrl`/`redirectUrl` form is used where the gateway is
      // configured to serve a standalone page. Confirm which BNCTL enables
      // -- if it is the JS embed, this returns the session id and the
      // checkout page loads their script with it instead.
      redirectUrl: pick(json, "checkoutUrl", "redirectUrl") || `${HOST}/checkout/entry/${sessionId}`,
      providerRef: input.paymentId,
      raw: json,
    };
  },

  verifyWebhook(rawBody: string, headers: Headers): WebhookVerification {
    if (!WEBHOOK_SECRET) {
      // Fail closed. An unverifiable webhook endpoint that marks orders paid
      // is a "set any order to paid" endpoint for anyone who finds the URL.
      return { ok: false, reason: "MPGS_WEBHOOK_SECRET is not set — refusing to trust any webhook" };
    }

    const provided = headers.get(SIGNATURE_HEADER);
    if (!provided) {
      return { ok: false, reason: `missing ${SIGNATURE_HEADER} header` };
    }

    const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex");

    // Compare in constant time, and only after a length check --
    // timingSafeEqual throws on mismatched lengths rather than returning
    // false, which would turn a bad signature into a 500 and a retry storm.
    const a = Buffer.from(provided.trim().toLowerCase());
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: "signature mismatch" };
    }
    return { ok: true };
  },

  parseEvent(rawBody: string): ProviderEvent {
    const json = JSON.parse(rawBody) as Record<string, unknown>;
    const order = (json.order || {}) as Record<string, unknown>;
    const transaction = (json.transaction || {}) as Record<string, unknown>;

    const paymentId = pick(order, "id") || pick(json, "orderId") || "";
    if (!paymentId) {
      throw new Error("Webhook payload has no order id");
    }

    return {
      // Prefer the provider's own transaction id so redeliveries dedupe.
      // Falling back to a hash of the body still dedupes byte-identical
      // retries, which is the common case.
      eventId:
        pick(transaction, "id") ||
        pick(json, "id", "notificationId") ||
        crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 32),
      paymentId,
      status: mapStatus(pick(json, "result"), pick(order, "status") || pick(json, "status")),
      amountMinor: parseAmount(order.amount ?? transaction.amount),
      currency: pick(order, "currency") || pick(transaction, "currency") || null,
      providerRef: paymentId,
      failureReason: pick(json, "error", "explanation") || undefined,
    };
  },

  async fetchStatus(providerRef: string): Promise<ProviderEvent | null> {
    if (!this.isConfigured()) return null;

    const res = await fetch(`${apiBase()}/order/${encodeURIComponent(providerRef)}`, {
      headers: { Authorization: authHeader() },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) return null;

    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }

    return {
      eventId: `status:${providerRef}:${pick(json, "status") || "unknown"}`,
      paymentId: providerRef,
      status: mapStatus(pick(json, "result"), pick(json, "status")),
      amountMinor: parseAmount(json.amount),
      currency: pick(json, "currency") || null,
      providerRef,
    };
  },
};
