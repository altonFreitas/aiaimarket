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

  /**
   * Send money back.
   *
   * Until this existed, recordReturn() wrote a refund_total and the
   * database asserted the buyer had been refunded while their money was
   * still with the acquirer -- and the only thing that moved it was
   * somebody remembering to open the bank portal, with nothing in the
   * application prompting them.
   *
   * `amountMinor` so a partial return refunds a part. Omitted means all of
   * it, which is what the gateway defaults to and what the common case
   * actually is.
   *
   * Returns the resulting state rather than a boolean: a refund can be
   * accepted and still be pending at the acquirer, and reporting that as
   * "done" is the same class of lie this method was added to stop.
   */
  refund(providerRef: string, amountMinor?: number): Promise<ProviderResult>;

  /**
   * Release a hold that will never be captured.
   *
   * A cancelled order leaves the buyer's funds on hold until the
   * authorization expires on the acquirer's own schedule -- typically
   * seven days, during which the money is neither theirs nor the shop's.
   * The state machine already models authorized -> cancelled; nothing
   * drove it.
   *
   * Only meaningful for an authorization. Capturing then voiding is not a
   * thing; that is a refund.
   */
  voidAuthorization(providerRef: string): Promise<ProviderResult>;
}

/** What came back from asking the gateway to move money.
 *
 * `ok` says the gateway ACCEPTED the instruction, and `status` says where
 * that left the payment. The two are different questions: an accepted
 * refund can still be pending settlement, and treating acceptance as
 * completion is exactly the conflation that let the database claim a
 * refund had happened. */
export interface ProviderResult {
  ok: boolean;
  status: PaymentStatus;
  /** The gateway's own reference for this movement, for reconciliation. */
  providerRef?: string | null;
  /** Why not, when not. Safe to show an admin; never shown to a buyer. */
  reason?: string;
}
