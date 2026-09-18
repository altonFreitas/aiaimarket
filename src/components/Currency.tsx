"use client";
import { createContext, useContext, useMemo } from "react";
import { formatMoney, DEFAULT_CURRENCY, normalizeCurrencyCode } from "@/lib/money";
import { convert } from "@/lib/fx";

/* THE CURRENCY THIS SHOP QUOTES IN.
 *
 * Settings has offered a currency since the money columns were added, and
 * choosing EUR changed nothing anywhere: every price on the storefront went
 * through money(n) with no second argument, so formatMoney fell back to its
 * USD default. The setting was real, saved, and read by nobody.
 *
 * It is one value for the whole shop and it changes about once, so it is
 * context rather than a prop threaded through ProductCard, CatalogLayout,
 * the home sections and the product page -- four levels of plumbing that
 * would be wrong in the one place somebody forgot.
 *
 * NOT A CONVERSION. This picks the symbol, the decimal places and which
 * side the symbol sits on. Prices are stored as plain numbers and are not
 * multiplied by anything: a shop that switches to EUR is saying "these
 * figures are euros", not asking for its catalog to be re-priced. Orders
 * record the code and an fx_rate of 1 for exactly the same reason.
 *
 * The default is USD, so a component rendered outside the provider -- a
 * test, a preview, an email -- prints what it printed before rather than
 * throwing. */
interface Quote {
  /** The code to print. USD whenever a rate could not be had. */
  code: string;
  /** Units of `code` per one US dollar. Exactly 1 for USD. */
  rate: number;
}

const Ctx = createContext<Quote>({ code: DEFAULT_CURRENCY, rate: 1 });

export function CurrencyProvider(
  { code, rate, children }: {
    code: string | null | undefined;
    /** What one dollar is worth in `code`, from lib/fx.ts. NULL when the
     * rate could not be fetched -- and null means show dollars, not
     * "multiply by 1": printing "€12.00" over an unconverted 12 states a
     * price that is wrong by about 15%, and it looks exactly like success. */
    rate: number | null;
    children: React.ReactNode;
  }
) {
  const value = useMemo<Quote>(() => {
    const wanted = normalizeCurrencyCode(code);
    if (wanted === DEFAULT_CURRENCY) return { code: DEFAULT_CURRENCY, rate: 1 };
    return rate && rate > 0
      ? { code: wanted, rate }
      : { code: DEFAULT_CURRENCY, rate: 1 };
  }, [code, rate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The code prices are being shown in. */
export function useCurrency(): string {
  return useContext(Ctx).code;
}

/** The whole quote -- code and rate -- for a caller that has to say what
 * the conversion was, such as the line at checkout naming it. */
export function useQuote(): Quote {
  return useContext(Ctx);
}

/** money(), already knowing which currency the shop quotes in.
 *
 * Client components call this instead of importing money() directly, which
 * is what stops the next price added to the storefront silently reverting
 * to dollars. */
export function useMoney(): (n: number | string) => string {
  const { code, rate } = useContext(Ctx);
  /* THE FIGURES ARE IN DOLLARS. Every price in this app is stored, banked
     and refunded in USD; this multiplies for display only. Rounding happens
     here, at the last step, because rounding before multiplying is how a
     cent becomes several across a basket. */
  return useMemo(
    () => (n: number | string) => formatMoney(convert(Number(n) || 0, rate), code),
    [code, rate]);
}
