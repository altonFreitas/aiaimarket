import { describe, it, expect } from "vitest";
import {
  DISPLAY_CURRENCIES, DEFAULT_CURRENCY, normalizeCurrencyCode, currencyInfo,
  formatMoney, normalizeTaxRate, taxRateAsPercent, taxOn, toBase,
} from "@/lib/money";

/* A DISPLAY CURRENCY, AND TAX.
 *
 * Both are arithmetic the shop is legally answerable for, and both have one
 * classic way of being subtly wrong: tax worked backwards out of an
 * inclusive price, and a rounding remainder that leaves the line shares not
 * adding up to the order. Those two are the reason this file is long.
 */

describe("the one currency this shop quotes in", () => {
  it("prints dollars", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("puts a minus outside the symbol", () => {
    /* "$-586.30" is what concatenating a symbol onto a formatted negative
       gives you, and on the one figure a profit-and-loss screen exists to
       produce it reads as a typo. */
    expect(formatMoney(-586.3)).toBe("-$586.30");
  });

  it("prints a row written before the currency picker was removed", () => {
    /* A settings row or an order may still carry EUR or IDR. The FIGURES
       were always dollars -- nothing ever converted them -- so printing a
       euro symbol over one would be the lie this simplification removes. */
    expect(formatMoney(10, "EUR")).toBe("$10.00");
    expect(formatMoney(10, "IDR")).toBe("$10.00");
    expect(normalizeCurrencyCode("eur")).toBe("USD");
    expect(normalizeCurrencyCode("")).toBe("USD");
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
