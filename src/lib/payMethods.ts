import type { Settings } from "./types";

/* WHAT THIS SHOP ACTUALLY TAKES, in one place.
 *
 * The footer prints it under the copyright and the cart prints it beside
 * the checkout button, which is two screens making the same promise. A
 * second copy of this list is how one of them ends up offering bank
 * transfer on a shop that has never entered a bank.
 *
 * Every entry is conditional on the setting that makes it true. Cash on
 * delivery is the one that always holds: this shop exists to deliver and
 * be paid at the door, and it is the fallback the checkout itself assumes.
 *
 * Returns i18n keys, not words, because the shopper's language is the
 * caller's business.
 */
export function acceptedPayments(
  settings: Pick<Settings, "pickup" | "banks" | "wallets">,
  /** From cardPaymentAvailable(). Passed in rather than read here so this
   * stays a pure function the tests can drive. */
  cardAvailable: boolean
): string[] {
  const out = ["pm_cod"];
  if (settings.pickup) out.push("pm_cop");
  if ((settings.banks ?? []).length) out.push("pm_bank");
  if ((settings.wallets ?? []).length) out.push("pm_wallet");
  if (cardAvailable) out.push("pm_card");
  return out;
}

/* ---------------------------------------------------------------------------
 * What the cart can honestly say about delivery
 * ------------------------------------------------------------------------ */

export interface DeliveryNote {
  /** i18n key for the line the cart shows. */
  key: string;
  /** Substituted into it. */
  vars: Record<string, string>;
}

/** The delivery sentence for a cart, or null when there is nothing true to
 * say.
 *
 * THE REFERENCE SAYS "Free shipping on orders over $50". This shop has no
 * such threshold and no setting that could carry one -- delivery is priced
 * by ZONE, and which zone is a question the checkout asks. So the cart says
 * one of two true things instead:
 *
 *   a zone that costs nothing exists  ->  name it, because "free delivery
 *                                         to Central Dili" is the offer
 *                                         this shop actually makes;
 *   every zone costs something        ->  say delivery is added at
 *                                         checkout and from how much,
 *                                         which is the honest version of a
 *                                         number the cart cannot know.
 *
 * Invented thresholds are the failure mode here: a cart that says "spend
 * $12 more for free delivery" on a shop with no free delivery has sold
 * something nobody can deliver.
 */
export function deliveryNote(
  zones: ReadonlyArray<{ id: string; fee: number; quote: boolean }>,
  zoneLabel: (id: string) => string
): DeliveryNote | null {
  const priced = zones.filter((z) => !z.quote);
  if (!priced.length) return null;

  const free = priced.find((z) => Number(z.fee) === 0);
  if (free) return { key: "cartFreeZone", vars: { zone: zoneLabel(free.id) } };

  const cheapest = priced.reduce((a, z) => (Number(z.fee) < Number(a.fee) ? z : a));
  return { key: "cartDeliveryFrom", vars: { fee: String(Number(cheapest.fee)) } };
}
