import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { taxOnLines } from "@/lib/tax";
import { normalizeTaxRate, taxRateAsPercent, taxOn, formatMoney } from "@/lib/money";

/* THE CENT SURVIVES, END TO END.
 *
 * "If the tax after applying the % comes to $13.95, do not round it up to
 * $14." Every step between the rate somebody types and the figure on the
 * invoice is checked here, because a rounding is not visible in any one of
 * them -- it is visible in the one that has it.
 *
 * THE ONE THAT DID. normalizeTaxRate keeps four decimal places of a
 * percentage; settings.tax_rate and orders.tax_rate were numeric(6,4),
 * which is two. Postgres rounded the difference away without a word. That
 * is what supabase/tax-precision.sql widens, and the last block here holds
 * the code and the column to the same number.
 */

describe("tax keeps its cents", () => {
  it("charges 13.95 rather than 14 on the example that prompted this", () => {
    // $279 of goods at 5%.
    const t = taxOnLines([279], 0, 0.05, false);
    expect(t.tax).toBe(13.95);
    expect(t.total).toBe(292.95);
    expect(formatMoney(t.tax)).toBe("$13.95");
  });

  it("does the same when the rate is what makes it awkward", () => {
    // 7.5% of 186 is 13.95 as well, by a different route.
    expect(taxOnLines([186], 0, 0.075, false).tax).toBe(13.95);
    // And a figure that is genuinely not round stays not round.
    expect(taxOnLines([123.45], 0, 0.0825, false).tax).toBe(10.18);
    expect(taxOnLines([19.99], 0, 0.021, false).tax).toBe(0.42);
  });

  it("rounds to the cent and never coarser, across a sweep", () => {
    for (let cents = 1; cents <= 20000; cents += 37) {
      for (const rate of [0.02, 0.05, 0.075, 0.1, 0.175, 0.2125]) {
        const base = cents / 100;
        const { tax } = taxOn(base, 0, rate, false);
        /* At most two decimal places. Asserted as "it survives a round
           trip through two decimals" rather than as tax*100 being an
           integer: tax*100 is itself a float, 0.07*100 is
           7.000000000000001, and that assertion would have been about
           IEEE 754 rather than about tax. */
        expect(Number(tax.toFixed(2))).toBe(tax);
        expect(Math.abs(tax - base * rate)).toBeLessThanOrEqual(0.005 + 1e-9);
      }
    }
  });

  it("keeps the cents when the tax is already inside the price", () => {
    // $110 at 10% inclusive holds $10, not $11 -- and not $10.00 rounded
    // up from $10.0000001 either.
    const inc = taxOnLines([110], 0, 0.1, true);
    expect(inc.includedTax).toBe(10);
    expect(inc.net).toBe(100);
    expect(inc.total).toBe(110);
    expect(taxOnLines([293.45], 0, 0.05, true).includedTax).toBe(13.97);
  });

  it("adds the lines up to the order's own figure, exactly", () => {
    /* Each line is taxed and rounded on its own and the total is the sum of
       the rounded lines. A return of one line has to give back that line's
       tax, and the lines have to add up to what the order says. */
    const t = taxOnLines([19.99, 5.49, 253.52], 0, 0.05, false);
    expect(t.perLine).toEqual([1, 0.27, 12.68]);
    expect(t.perLine.reduce((a, n) => a + n, 0)).toBeCloseTo(t.tax, 10);
  });

  it("taxes the delivery fee with the goods, which is why a figure can look round", () => {
    /* Stated as a test because it is the likeliest reason a shop reads a
       tax figure as "rounded up": $279 of goods plus a $1 delivery fee at
       5% is $14.00, and it is $14.00 exactly rather than $13.95 rounded.
       If this is wrong for a shop, THIS is the line to change. */
    expect(taxOnLines([279], 1, 0.05, false).tax).toBe(14);
    expect(taxOnLines([279], 0, 0.05, false).tax).toBe(13.95);
  });
});

describe("the rate the shop typed is the rate it charges", () => {
  it("keeps four decimal places of a percentage", () => {
    expect(normalizeTaxRate(7.125)).toBe(0.07125);
    expect(normalizeTaxRate(2.5)).toBe(0.025);
    expect(normalizeTaxRate(13.9525)).toBe(0.139525);
    expect(taxRateAsPercent(0.07125)).toBe(7.125);
  });

  it("refuses a rate outside 0-100 rather than charging it", () => {
    expect(normalizeTaxRate(250)).toBe(0);
    expect(normalizeTaxRate(-1)).toBe(0);
    expect(normalizeTaxRate("abc")).toBe(0);
  });

  it("is stored in a column wide enough to hold it", () => {
    /* numeric(6,4) is four decimals of the FRACTION and so two of the
       percentage: 0.07125 went in and 0.0713 came back, silently, and the
       shop charged 7.13% while its settings page said 7.125%. */
    const root = path.join(__dirname, "..");
    const widen = fs.readFileSync(path.join(root, "supabase/tax-precision.sql"), "utf8");
    expect(widen).toContain("alter table settings alter column tax_rate type numeric(9,6)");
    expect(widen).toContain("alter table orders alter column tax_rate type numeric(9,6)");

    // Six decimals of a fraction is four of a percentage, which is exactly
    // what normalizeTaxRate keeps. If one of them ever changes, so must
    // the other.
    const money = fs.readFileSync(path.join(root, "src/lib/money.ts"), "utf8");
    expect(money).toContain("Math.round(n * 1e4) / 1e6");
  });

  it("leaves every money column alone", () => {
    // The amounts were never the problem: cents, exactly, in and out.
    const legal = fs.readFileSync(
      path.join(__dirname, "..", "supabase/legal-currency-tax.sql"), "utf8");
    expect(legal).toContain("tax      numeric(10,2) not null default 0");
    const widen = fs.readFileSync(
      path.join(__dirname, "..", "supabase/tax-precision.sql"), "utf8");
    expect(widen).not.toMatch(/alter column (tax|total|subtotal|fee) type/);
  });
});
