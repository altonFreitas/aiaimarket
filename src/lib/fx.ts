import { unstable_cache } from "next/cache";
import { DISPLAY_CURRENCIES, DEFAULT_CURRENCY, normalizeCurrencyCode } from "@/lib/money";

/* WHAT A DOLLAR IS WORTH TODAY.
 *
 * The shop's prices are typed, stored and banked in USD -- Timor-Leste uses
 * the dollar, and the money that changes hands at the door is dollars. The
 * display currency is a courtesy to somebody reading prices in a currency
 * they think in.
 *
 * SO THIS CONVERTS FOR DISPLAY AND NOTHING ELSE. Orders are stored in USD,
 * every revenue figure and every report stays in USD, and the rate that was
 * used is frozen onto the order so the same document prints the same
 * figures next year. Storing euros on the order instead would have been the
 * other obvious design, and it would have quietly corrupted six revenue
 * sums that add o.total straight up -- they would have been adding euros to
 * dollars from the day the setting changed.
 *
 * FAILING SAFE MEANS SHOWING DOLLARS. If the rate cannot be fetched, the
 * storefront shows USD -- the currency the figures are actually in. The
 * alternative, printing "€12.00" over an unconverted 12, states a price
 * that is wrong by about 15%, and it is the failure mode nobody notices
 * because it looks exactly like success.
 */

/** Where the rates come from.
 *
 * An env var, so a shop can point at a provider it trusts -- or one that is
 * reachable from where it is hosted -- without a code change. The default
 * is free and needs no key. Whatever answers must return
 * `{ rates: { EUR: 0.87, ... } }` with USD as the base. */
const RATES_URL = process.env.FX_RATES_URL
  || "https://open.er-api.com/v6/latest/USD";

/** How long a rate is good for.
 *
 * Six hours. Retail prices do not need the interbank tick, and a shop that
 * re-priced its whole catalog every minute would show two different totals
 * to somebody who refreshed. It also keeps the shop far inside any free
 * provider's rate limit. */
const FX_TTL_SECONDS = 6 * 60 * 60;

export interface FxRates {
  /** Units of each currency per ONE US dollar. USD is always exactly 1. */
  rates: Record<string, number>;
  /** When the provider says these were set, for the line the checkout
   * shows. Absent when the provider does not say. */
  asOf: string | null;
}

/** A rate is only usable if it is a finite, positive number.
 *
 * Providers do return nulls, strings and zeros for currencies they have
 * stopped quoting, and a zero rate turns every price into "0.00" -- which
 * is a shop giving its stock away rather than a display bug. */
function usable(v: unknown): v is number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

/** Reads a provider's answer into the shape above, keeping only the
 * currencies this app can actually print. */
export function parseRates(body: unknown): FxRates | null {
  const obj = body as { rates?: Record<string, unknown>; time_last_update_utc?: string;
                        date?: string } | null;
  if (!obj || typeof obj !== "object" || !obj.rates) return null;
  const out: Record<string, number> = { [DEFAULT_CURRENCY]: 1 };
  for (const code of Object.keys(DISPLAY_CURRENCIES)) {
    if (code === DEFAULT_CURRENCY) continue;
    const v = obj.rates[code];
    if (usable(v)) out[code] = Number(v);
  }
  // Nothing but the dollar came back: treat it as a failure rather than as
  // a world in which no other currency exists.
  if (Object.keys(out).length < 2) return null;
  return { rates: out, asOf: obj.time_last_update_utc || obj.date || null };
}

async function fetchRatesUncached(): Promise<FxRates | null> {
  try {
    const res = await fetch(RATES_URL, {
      // The shop's page must not hang on somebody else's server.
      signal: AbortSignal.timeout(4000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return parseRates(await res.json());
  } catch {
    // Offline, blocked, slow, malformed -- all the same answer: no rate,
    // and the caller shows dollars.
    return null;
  }
}

/** Today's rates, fetched at most once every few hours across all visitors. */
export const getFxRates = unstable_cache(fetchRatesUncached, ["fx-rates"], {
  revalidate: FX_TTL_SECONDS,
  tags: ["fx-rates"],
});

/** What one US dollar is worth in `code`, or null when it cannot be known.
 *
 * Null is the signal to show dollars. It is deliberately not "1": a rate of
 * 1 would print euro symbols over dollar figures, which is the wrong answer
 * dressed as the right one.
 */
export async function displayRate(code: string | null | undefined): Promise<number | null> {
  const want = normalizeCurrencyCode(code);
  if (want === DEFAULT_CURRENCY) return 1;
  const fx = await getFxRates();
  const rate = fx?.rates?.[want];
  return usable(rate) ? rate : null;
}

/** A price in USD, as the number to print in the display currency.
 *
 * Rounded to the currency's own precision at the LAST step -- rounding
 * before multiplying is how a cent becomes a few cents across a basket. */
export function convert(amountUsd: number, rate: number, digits = 2): number {
  const n = (Number(amountUsd) || 0) * (Number(rate) || 1);
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
