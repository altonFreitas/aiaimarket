import type { Currency } from "./money";
import type { PaymentStatus } from "./state";

/** Provider-agnostic payment interfaces.
 *
 * The point of this file is that nothing outside lib/payments/providers/*
 * knows which gateway is in use. Switching acquirer, or running two in
 * parallel (BNCTL for cards, something else for wallets), is a new file in
 * providers/ and a registry entry -- not a rewrite of checkout.
 *
 * NOTE ON PCI SCOPE -- this is the load-bearing design decision here:
 * there is no card number, expiry or CVV anywhere in this codebase, and
 * there must never be. Every provider implemented against this interface
 * MUST use a hosted payment page or a redirect flow, so card data goes
 * from the buyer's browser straight to the acquirer and never touches this
 * server. That keeps the store in PCI-DSS SAQ A (a short self-assessment)
 * instead of SAQ D (a full audit, annual scanning, and a compliance
 * programme). Accepting a PAN in a form field on this domain is not a
 * feature to add later; it is a different company.
 */

export interface CreateCheckoutInput {
  /** Our own payments row id — used as the provider's order reference so a
   * gateway record can always be traced back to one row here. */
  paymentId: string;
  /** The human-facing order reference (e.g. CD20261234567890). */
  orderRef: string;
  amountMinor: number;
  currency: Currency;
  description: string;
  /** Where the gateway sends the buyer's browser afterwards. Informational
   * only — the outcome is never taken from this redirect. */
  returnUrl: string;
}

export interface CheckoutSession {
  /** Where to send the buyer. */
  redirectUrl: string;
  /** The gateway's own handle for this attempt, stored for reconciliation. */
  providerRef: string;
  /** Anything else worth keeping for a dispute months from now. */
  raw?: unknown;
}

/** The normalized shape every provider event is reduced to before the rest
 * of the app sees it. */
export interface ProviderEvent {
  /** Stable per-event id, used to drop duplicate deliveries. */
  eventId: string;
  /** Our payments row id, recovered from the provider's payload. */
  paymentId: string;
  status: PaymentStatus;
  amountMinor: number | null;
  currency: string | null;
  providerRef: string | null;
  failureReason?: string;
}

export type WebhookVerification =
  | { ok: true }
  | { ok: false; reason: string };

export interface PaymentProvider {
  readonly id: string;
  /** True when the provider has all the configuration it needs. Lets the
   * UI hide card payment entirely rather than offering a button that
   * throws. */
  isConfigured(): boolean;
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  /** Verified against the RAW request body — never a re-serialized object,
   * because JSON.stringify does not round-trip byte-for-byte and the
   * signature is over the bytes the provider actually sent. */
  verifyWebhook(rawBody: string, headers: Headers): WebhookVerification;
  parseEvent(rawBody: string): ProviderEvent;
  /**
   * Ask the gateway directly what happened. This is the authoritative
   * path: the buyer's return redirect is attacker-controllable and is used
   * only as a hint that it is worth asking.
   */
  fetchStatus(providerRef: string): Promise<ProviderEvent | null>;
}
