import { ZONE_IDS, zoneLabelKey } from "@/lib/zones";
import type { Settings, Zone } from "@/lib/types";

/* THE STRIP UNDER THE HEADER: what this shop actually offers.
 *
 * Every marquee of this kind on the internet says the same four things --
 * Free Shipping, Secure Checkout, Easy Returns, Eco-Conscious Design --
 * and most of the shops running it have not checked whether any of them
 * are true of themselves. "Free shipping" on a shop that charges $1 to
 * Dili centre is a promise the checkout then breaks, and the shopper
 * learns it at the worst possible moment.
 *
 * So every line here is READ OUT OF SETTINGS, and a setting that is not
 * filled in produces no line rather than a default. The same rule the
 * delivery promises on the product page follow (lib/deliveryPromise.ts),
 * for the same reason.
 *
 * THE TWO THAT ARE NOT SETTINGS are true of the software rather than of
 * the shop, which is why they need no switch: the stock count on every
 * product comes off a real ledger, and the site genuinely is written in
 * three languages. Neither can be false while this code is running.
 */

export type IncentiveIcon =
  | "wa" | "truck" | "store" | "return" | "bank" | "wallet" | "stock" | "globe";

export interface Incentive {
  /** Which drawing to put beside it. */
  icon: IncentiveIcon;
  /** i18n key for the bold line. */
  titleKey: string;
  /** i18n key for the sentence under it. */
  bodyKey: string;
  /** Substituted into "{n}" of either key. Already resolved to a NUMBER
   * or to another i18n key, which the caller translates -- see `nIsKey`. */
  n?: string;
  /** Whether `n` is itself a key to translate (a zone name) rather than a
   * value to print (a count of days). */
  nIsKey?: boolean;
}

/** A marquee needs a few things to be a marquee. Below this the strip
 *  draws nothing at all: two items sliding past is not a marquee, it is
 *  two items that will not keep still. */
export const MIN_INCENTIVES = 3;

export function incentives(settings: Settings): Incentive[] {
  const out: Incentive[] = [];

  // Every product page has an Order via WhatsApp button behind this
  // number, so the claim and the button are the same fact.
  if (settings.wa_number) {
    out.push({ icon: "wa", titleKey: "incWaT", bodyKey: "incWaB" });
  }

  /* The cheapest zone the shop delivers to. A zone set to "quote on
     request" has no number and is therefore not a promise; it is left
     out rather than described vaguely. */
  const zones: Zone[] = Array.isArray(settings.zones) ? settings.zones : [];
  const priced = zones.filter(
    (z) => z && !z.quote && Number.isFinite(Number(z.fee)) && ZONE_IDS.includes(z.id)
  );
  if (priced.length) {
    const best = priced.reduce((a, b) => (Number(a.fee) <= Number(b.fee) ? a : b));
    out.push(Number(best.fee) === 0
      // Free delivery is the line every shop wants; this one earns it
      // only where a zone's fee is genuinely zero.
      ? { icon: "truck", titleKey: "incFreeT", bodyKey: "incFreeB",
          n: zoneLabelKey(best.id), nIsKey: true }
      : { icon: "truck", titleKey: "incDelivT", bodyKey: "incDelivB" });
  }

  if (settings.pickup) {
    out.push({ icon: "store", titleKey: "incPickT", bodyKey: "incPickB" });
  }

  const days = Number(settings.legal_return_days);
  if (Number.isFinite(days) && days > 0) {
    out.push({ icon: "return", titleKey: "incRetT", bodyKey: "incRetB",
      n: String(Math.floor(days)) });
  }

  // The bank details and the wallet numbers a buyer is actually given at
  // checkout. No rows, no claim.
  if (Array.isArray(settings.banks) && settings.banks.length) {
    out.push({ icon: "bank", titleKey: "incBankT", bodyKey: "incBankB" });
  }
  if (Array.isArray(settings.wallets) && settings.wallets.length) {
    out.push({ icon: "wallet", titleKey: "incWalletT", bodyKey: "incWalletB" });
  }

  /* TRUE OF THE SOFTWARE, not of the shop's paperwork, so no setting
     gates them. The number on a product page is a balance off
     stock_movements rather than a figure somebody typed, and the site
     really is served in Tetum, Portuguese and English. */
  out.push({ icon: "stock", titleKey: "incStockT", bodyKey: "incStockB" });
  out.push({ icon: "globe", titleKey: "incLangT", bodyKey: "incLangB" });

  return out;
}
