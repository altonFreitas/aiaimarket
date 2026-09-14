import { describe, it, expect } from "vitest";
import {
  DISPLAY_CURRENCIES, DEFAULT_CURRENCY, normalizeCurrencyCode, currencyInfo,
  formatMoney, normalizeTaxRate, taxRateAsPercent, taxOn, apportionTax, toBase,
} from "@/lib/money";

/* A DISPLAY CURRENCY, AND TAX.
 *
 * Both are arithmetic the shop is legally answerable for, and both have one
 * classic way of being subtly wrong: tax worked backwards out of an
 * inclusive price, and a rounding remainder that leaves the line shares not
 * adding up to the order. Those two are the reason this file is long.
 */

describe("which currency the shop quotes in", () => {
  it("is the dollar unless the shop says otherwise", () => {
    // Timor-Leste uses the US dollar. Nothing changes for the shop this was
    // written for.
    expect(DEFAULT_CURRENCY).toBe("USD");
    expect(normalizeCurrencyCode(undefined)).toBe("USD");
    expect(normalizeCurrencyCode("")).toBe("USD");
  });

  it("accepts a code the shop typed in any case", () => {
    expect(normalizeCurrencyCode("aud")).toBe("AUD");
    expect(normalizeCurrencyCode(" eur ")).toBe("EUR");
  });

  it("falls back rather than throwing on a code it cannot print", () => {
    /* A settings row carrying an unknown code must not take the storefront
       down. Showing dollars is the honest behaviour for this shop; showing
       a crash is not. */
    expect(normalizeCurrencyCode("XYZ")).toBe("USD");
    expect(normalizeCurrencyCode(42)).toBe("USD");
  });

  it("knows a currency with no decimal places", () => {
    // THE BUG A HARDCODED ×100 CAUSES. Rupiah has no minor unit, so "Rp
    // 45.000,00" is not a price anybody in Indonesia has ever seen.
    expect(currencyInfo("IDR").digits).toBe(0);
    expect(formatMoney(45000, "IDR")).toBe("Rp45,000");
  });

  it("puts the symbol where that currency puts it", () => {
    expect(formatMoney(12, "USD")).toBe("$12.00");
    expect(formatMoney(12, "EUR")).toBe("12.00 €");
  });

  it("puts a minus outside the symbol", () => {
    /* "$-586.30" is what concatenation gives you, and on the one figure a
       profit-and-loss screen exists to produce it reads as a typo. */
    expect(formatMoney(-586.3)).toBe("-$586.30");
    expect(formatMoney(-586.3, "EUR")).toBe("-586.30 €");
  });

  it("groups thousands", () => {
    expect(formatMoney(1234567.5)).toBe("$1,234,567.50");
  });

  it("survives whatever a column hands it", () => {
    expect(formatMoney(null as unknown as number)).toBe("$0.00");
    expect(formatMoney("19.99")).toBe("$19.99");
    expect(formatMoney(NaN)).toBe("$0.00");
  });

  it("can print every currency it offers", () => {
    // An entry added to the table without a symbol or with a bad digit count
    // fails here rather than on a shopper's screen.
    for (const code of Object.keys(DISPLAY_CURRENCIES)) {
      expect([code, formatMoney(1, code).length > 1]).toEqual([code, true]);
    }
  });
});

describe("the tax rate the shop typed", () => {
  it("is a percentage in the box and a fraction in the column", () => {
    expect(normalizeTaxRate(2.5)).toBe(0.025);
    expect(normalizeTaxRate(10)).toBe(0.1);
    expect(taxRateAsPercent(0.025)).toBe(2.5);
  });

  it("round-trips, so the box shows back what was typed", () => {
    for (const p of [0.5, 2.5, 5, 7.25, 10, 17.5, 20]) {
      expect([p, taxRateAsPercent(normalizeTaxRate(p))]).toEqual([p, p]);
    }
  });

  it("refuses a rate nobody meant", () => {
    // 250 in the box is a fat finger, not two hundred and fifty percent.
    // Charging nothing is the safe direction to fail in: it shows up on the
    // next invoice rather than silently on every one.
    expect(normalizeTaxRate(250)).toBe(0);
    expect(normalizeTaxRate(-5)).toBe(0);
    expect(normalizeTaxRate("abc")).toBe(0);
  });
});

describe("tax on an order", () => {
  it("adds nothing when the shop charges none", () => {
    // The default, and the whole behaviour of this shop today.
    expect(taxOn(100, 5, 0, false)).toEqual({ tax: 0, net: 105, total: 105, includedTax: 0 });
  });

  it("adds it on top when prices are net", () => {
    expect(taxOn(100, 0, 0.1, false)).toEqual({ tax: 10, net: 100, total: 110, includedTax: 0 });
  });

  it("works it back out when prices already include it", () => {
    /* THE ONE THAT IS ALMOST ALWAYS WRONG. On a $100 inclusive price at 10%
       the tax is $9.09, not $10 -- because 100 is the gross and 100/1.1 is
       90.91. Taking 10% of the gross overstates what the shop owes by a
       tenth, on every order, for ever. */
    const t = taxOn(100, 0, 0.1, true);
    expect(t.total).toBe(100);
    expect(t.includedTax).toBe(9.09);
    expect(t.net).toBe(90.91);
    expect(t.tax).toBe(0);            // nothing is ADDED to an inclusive price
  });

  it("taxes the delivery fee with the goods", () => {
    const t = taxOn(100, 10, 0.1, false);
    expect(t.tax).toBe(11);
  });

  it("never taxes a negative basket", () => {
    expect(taxOn(-50, 0, 0.1, false).tax).toBe(0);
  });

  it("rounds to the cent, not to something longer", () => {
    const t = taxOn(19.99, 0, 0.075, false);
    expect(t.tax).toBe(1.5);
    expect(t.total).toBe(21.49);
    expect(Number.isInteger(t.total * 100)).toBe(true);
  });
});

describe("splitting the tax across the lines", () => {
  it("adds back to the order's figure exactly", () => {
    /* THE ROUNDING REMAINDER. $1.00 across three equal lines is 33+33+34,
       not 33+33+33 and a cent the books cannot explain -- and that cent is
       what a return of the last line would get wrong. */
    const shares = apportionTax([10, 10, 10], 1);
    expect(shares).toEqual([0.33, 0.33, 0.34]);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("gives each line its share of the value, not an equal slice", () => {
    const shares = apportionTax([75, 25], 10);
    expect(shares).toEqual([7.5, 2.5]);
  });

  it("is all zeroes when there is no tax", () => {
    expect(apportionTax([10, 20], 0)).toEqual([0, 0]);
  });

  it("does not divide by an empty basket", () => {
    expect(apportionTax([], 5)).toEqual([]);
    expect(apportionTax([0, 0], 5)).toEqual([0, 0]);
  });

  it("adds up however awkward the split", () => {
    // Property rather than example: the invariant is that the shares sum to
    // the order's tax, and it has to hold for values chosen to be awkward.
    for (const values of [[1, 1, 1], [0.01, 99.99], [3, 3, 3, 3, 3, 3, 3]]) {
      for (const tax of [0.01, 0.07, 1, 12.34]) {
        const sum = apportionTax(values, tax).reduce((a, b) => a + b, 0);
        expect([values.length, tax, Math.round(sum * 100) / 100]).toEqual([values.length, tax, tax]);
      }
    }
  });
});

describe("converting a quote back to the shop's books", () => {
  it("leaves a dollar order alone", () => {
    expect(toBase(45, 1)).toBe(45);
  });

  it("uses the rate captured on the order", () => {
    // 0.65 USD per AUD: A$100 was $65 on the day it was agreed, and stays
    // $65 whatever the rate does afterwards.
    expect(toBase(100, 0.65)).toBe(65);
  });

  it("treats a missing or impossible rate as one", () => {
    // An order from before this column existed carries no rate. Reading it
    // as zero would restate every historical total as nothing.
    expect(toBase(45, 0)).toBe(45);
    expect(toBase(45, NaN)).toBe(45);
    expect(toBase(45, -1)).toBe(45);
  });
});
