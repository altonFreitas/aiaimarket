import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseRates, convert } from "@/lib/fx";

/* PRICES SHOWN IN A CURRENCY THE SHOP DOES NOT BANK IN.
 *
 * The display-currency setting used to change the SYMBOL and nothing else:
 * "$12.00" became "12,00 €" over the same 12, which states a price roughly
 * 15% wrong. It now converts at a live rate.
 *
 * The live fetch itself is not exercised here -- this sandbox blocks
 * outbound HTTP -- so everything around it is: what a provider's answer is
 * read as, what happens when there is no answer, and the arithmetic.
 */

describe("reading a provider's answer", () => {
  it("keeps the currencies this app can print, and the dollar as 1", () => {
    const fx = parseRates({ rates: { EUR: 0.87, IDR: 16250, JPY: 157 } });
    expect(fx?.rates.USD).toBe(1);
    expect(fx?.rates.EUR).toBe(0.87);
    expect(fx?.rates.IDR).toBe(16250);
    // JPY is not in DISPLAY_CURRENCIES: this app has no format for it, and
    // a rate it cannot print is not worth carrying.
    expect(fx?.rates.JPY).toBeUndefined();
  });

  it("throws out a rate of zero", () => {
    /* Providers return zeros and nulls for currencies they have stopped
       quoting. A zero rate turns every price into 0.00, which is a shop
       giving its stock away rather than a display bug. */
    const fx = parseRates({ rates: { EUR: 0, AUD: 1.5 } });
    expect(fx?.rates.EUR).toBeUndefined();
    expect(fx?.rates.AUD).toBe(1.5);
  });

  it("throws out nulls, strings and negatives", () => {
    const fx = parseRates({ rates: { EUR: null, AUD: "1.5", SGD: -2, IDR: 16000 } });
    expect(fx?.rates.EUR).toBeUndefined();
    expect(fx?.rates.SGD).toBeUndefined();
    expect(fx?.rates.IDR).toBe(16000);
    // A numeric string is a number a provider wrote badly, not a refusal.
    expect(fx?.rates.AUD).toBe(1.5);
  });

  it("treats a malformed answer as no answer", () => {
    for (const body of [null, undefined, {}, { rates: null }, "nope", 42]) {
      expect(parseRates(body)).toBeNull();
    }
  });

  it("treats an answer with nothing but the dollar as no answer", () => {
    // Not a world in which no other currency exists -- a broken response.
    expect(parseRates({ rates: { USD: 1 } })).toBeNull();
  });
});

describe("the arithmetic", () => {
  it("converts and rounds at the last step", () => {
    expect(convert(12, 0.87)).toBe(10.44);
    expect(convert(45, 0.8712)).toBe(39.2);
  });

  it("rounds to the currency's own precision", () => {
    // IDR has no minor unit; 2 decimals on a rupiah price is noise.
    expect(convert(12, 16250, 0)).toBe(195000);
  });

  it("leaves a dollar shop untouched", () => {
    expect(convert(12.34, 1)).toBe(12.34);
  });
});

describe("what happens when the rate cannot be had", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/fx.ts"), "utf8");
  const provider = fs.readFileSync(
    path.join(process.cwd(), "src/components/Currency.tsx"), "utf8");

  it("returns null rather than 1", () => {
    /* THE FAILURE THAT MATTERS. A rate of 1 would print euro symbols over
       dollar figures -- the wrong answer dressed as the right one, and the
       one nobody notices because it looks like success. Null is the signal
       to show dollars. */
    expect(src).toMatch(/return usable\(rate\) \? rate : null/);
  });

  it("makes the storefront fall back to dollars", () => {
    expect(provider).toMatch(/rate && rate > 0\s*\?\s*\{ code: wanted, rate \}\s*:\s*\{ code: DEFAULT_CURRENCY, rate: 1 \}/);
  });

  it("does not hang a page on somebody else's server", () => {
    expect(src).toMatch(/AbortSignal\.timeout\(\d+\)/);
  });

  it("asks at most every few hours, not per visitor", () => {
    expect(src).toMatch(/unstable_cache\(fetchRatesUncached/);
    expect(src).toMatch(/revalidate: FX_TTL_SECONDS/);
  });
});

describe("what is stored, and what is only shown", () => {
  const orders = fs.readFileSync(
    path.join(process.cwd(), "src/lib/actions/orders.ts"), "utf8");
  const fiscal = fs.readFileSync(
    path.join(process.cwd(), "src/lib/pdfFiscal.ts"), "utf8");
  const track = fs.readFileSync(
    path.join(process.cwd(), "src/components/TrackForm.tsx"), "utf8");

  it("freezes the rate onto the order", () => {
    /* Every figure on an order is USD -- which is what the shop banks and
       what six revenue sums add up. fx_rate says what one of those dollars
       was worth when the order was placed, so an invoice reprinted next
       year shows the euros the customer agreed to. */
    expect(orders).toMatch(/const fxRate = \(await displayRate\(currency\)/);
    expect(orders).toMatch(/fx_rate: fxRate/);
  });

  it("prints a past order at its own rate, never today's", () => {
    expect(fiscal).toMatch(/Number\(o\.fx_rate\) > 0 \? Number\(o\.fx_rate\) : 1/);
    expect(track).toMatch(/Number\(o\.fx_rate\) > 0 \? Number\(o\.fx_rate\) : 1/);
  });

  it("tells the shopper what will actually be collected", () => {
    /* The shop banks dollars. Showing a euro total without saying so
       misstates the transaction to somebody about to count out cash. */
    const co = fs.readFileSync(
      path.join(process.cwd(), "src/components/CheckoutForm.tsx"), "utf8");
    expect(co).toMatch(/quote\.code !== "USD"/);
    expect(co).toMatch(/chargedInUsd/);
  });
});
