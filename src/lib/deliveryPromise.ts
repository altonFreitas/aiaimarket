import { ZONE_IDS, zoneLabelKey } from "@/lib/zones";
import type { Settings, Zone } from "@/lib/types";

/* WHAT THE SHOP ACTUALLY PROMISES, for the reassurance box under the
 * buttons.
 *
 * The reference reads "Free shipping on orders over $50", "Cash on
 * delivery available", "7-day easy returns". This shop has no
 * free-shipping threshold -- delivery is a fee per zone plus collection
 * in store -- so that first line would be a promise on the product page
 * that nobody in the shop had made. A shopper who reads it and is then
 * charged for delivery has been misled by the website, which is a worse
 * problem than a box that says something duller.
 *
 * So each line is read out of Settings, and a setting that is not there
 * produces no line rather than a default. Three facts or one, whichever
 * is true.
 *
 * RETURNS ONLY WHEN THE WINDOW IS SET. legal_return_days is the same
 * number the returns policy prints; two places stating a window and one
 * of them guessing is how a shop ends up arguing with a customer holding
 * a screenshot.
 */

export type PromiseKind = "delivery" | "pickup" | "returns";

export interface DeliveryPromise {
  kind: PromiseKind;
  /** Already-resolved text, or an i18n key with its substitution. The
   * caller translates; this decides WHAT is true, not how to say it. */
  key: string;
  /** For "{n}" in the key. */
  n?: string;
}

export function deliveryPromises(settings: Settings): DeliveryPromise[] {
  const out: DeliveryPromise[] = [];

  /* The cheapest zone the shop delivers to, which is the one worth
     leading with -- and on a page read mostly in Dili, it is Dili. A
     zone set to "quote on request" has no number to show, so it is not
     a promise and is left out. */
  const zones: Zone[] = Array.isArray(settings.zones) ? settings.zones : [];
  const priced = zones.filter(
    (z) => z && !z.quote && Number.isFinite(Number(z.fee)) && ZONE_IDS.includes(z.id)
  );
  if (priced.length) {
    const best = priced.reduce((a, b) => (Number(a.fee) <= Number(b.fee) ? a : b));
    out.push(
      Number(best.fee) === 0
        // Free delivery IS the promise the reference wanted, and here it
        // is only made when a zone's fee is genuinely zero.
        ? { kind: "delivery", key: "promiseFreeTo", n: zoneLabelKey(best.id) }
        : { kind: "delivery", key: "promiseFeeTo", n: zoneLabelKey(best.id) }
    );
  }

  if (settings.pickup) out.push({ kind: "pickup", key: "promisePickup" });

  const days = Number(settings.legal_return_days);
  if (Number.isFinite(days) && days > 0) {
    out.push({ kind: "returns", key: "promiseReturns", n: String(Math.floor(days)) });
  }

  return out;
}

/** The fee that goes with the delivery line, for the caller to format as
 *  money. Null when the line is the free one or there is no line. */
export function bestZoneFee(settings: Settings): number | null {
  const zones: Zone[] = Array.isArray(settings.zones) ? settings.zones : [];
  const priced = zones.filter(
    (z) => z && !z.quote && Number.isFinite(Number(z.fee)) && ZONE_IDS.includes(z.id)
  );
  if (!priced.length) return null;
  const best = priced.reduce((a, b) => (Number(a.fee) <= Number(b.fee) ? a : b));
  return Number(best.fee) === 0 ? null : Number(best.fee);
}
