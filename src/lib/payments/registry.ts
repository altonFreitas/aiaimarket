import "server-only";
import type { PaymentProvider } from "./types";
import { mpgsProvider } from "./providers/mpgs";

/** Every gateway this store can talk to, by id.
 *
 * Adding a second acquirer is one import and one entry. Nothing else in the
 * app branches on which provider is in play.
 */
const PROVIDERS: Record<string, PaymentProvider> = {
  [mpgsProvider.id]: mpgsProvider,
};

export function getProvider(id: string): PaymentProvider | null {
  return PROVIDERS[id] ?? null;
}

/** The provider used for new card payments. Configurable so a test/staging
 * acquirer can be pointed at without a code change. */
export function defaultProviderId(): string {
  return process.env.PAYMENT_PROVIDER || mpgsProvider.id;
}

/** Is card payment actually available right now?
 *
 * Checkout calls this to decide whether to OFFER the card option at all.
 * Showing a payment method that throws the moment it is pressed is worse
 * than not showing it: the buyer has already committed to the order by
 * then.
 */
export function cardPaymentAvailable(): boolean {
  const p = getProvider(defaultProviderId());
  return Boolean(p && p.isConfigured());
}
