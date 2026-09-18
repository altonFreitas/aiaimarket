"use client";
import { createContext, useContext, useMemo } from "react";
import { formatMoney, DEFAULT_CURRENCY, normalizeCurrencyCode } from "@/lib/money";

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
const Ctx = createContext<string>(DEFAULT_CURRENCY);

export function CurrencyProvider(
  { code, children }: { code: string | null | undefined; children: React.ReactNode }
) {
  // Normalised here, once: a settings row holding a code this build cannot
  // format must show dollars rather than take the storefront down.
  const value = useMemo(() => normalizeCurrencyCode(code), [code]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The shop's currency code, for the rare caller that needs the code itself
 * rather than a formatted figure. */
export function useCurrency(): string {
  return useContext(Ctx);
}

/** money(), already knowing which currency the shop quotes in.
 *
 * Client components call this instead of importing money() directly, which
 * is what stops the next price added to the storefront silently reverting
 * to dollars. */
export function useMoney(): (n: number | string) => string {
  const code = useContext(Ctx);
  return useMemo(() => (n: number | string) => formatMoney(n, code), [code]);
}
