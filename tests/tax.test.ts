import { describe, it, expect } from "vitest";
import { taxOnLines, taxWasIncluded } from "@/lib/tax";
import { taxOn } from "@/lib/money";
import fs from "node:fs";
import path from "node:path";

/* TAX, AT THE SHOP'S ONE RATE.
 *
 * The arithmetic here decides what a customer is charged and what the shop
 * owes, so every case below is one where being a cent or a tenth out is a
 * real error rather than a tidiness question.
 */

describe("tax on an order, and each line's share of it", () => {
  it("adds up: the lines sum to the order's tax exactly", () => {
    /* Each line is rounded on its own and the total is the sum of the
       rounded lines, so what the order says and what its lines say are the
       same number. Apportioning a rounded total backwards is what leaves a
       cent the books cannot explain -- and that cent is what a return of
       the last line would get wrong. */
    const out = taxOnLines([33.33, 33.33, 33.34], 0, 0.1, false);
    const summed = Math.round(out.perLine.reduce((a, n) => a + n, 0) * 100) / 100;
    expect(summed).toBe(out.tax);
  });

  it("taxes the delivery fee with the goods", () => {
    const out = taxOnLines([100], 10, 0.1, false);
    expect(out.tax).toBe(11);
    expect(out.total).toBe(121);
  });

  it("works tax-inclusive, which is not the same sum backwards", () => {
    /* On a $110 tax-inclusive price at 10%, the tax already inside is $10
       (110/1.1 = 100), NOT $11. Getting this backwards overstates what the
       shop owes by a tenth on every order, and it is the commonest error in
       hand-written tax code. */
    const out = taxOnLines([110], 0, 0.1, true);
    expect(out.includedTax).toBe(10);
    expect(out.tax).toBe(0);
    expect(out.total).toBe(110);
    expect(out.net).toBe(100);
  });

  it("agrees with the single-line function", () => {
    for (const [sub, fee, rate] of [[12, 1, 0.1], [99.99, 2.5, 0.025], [40, 0, 0]] as const) {
      const before = taxOn(sub, fee, rate, false);
      const after = taxOnLines([sub], fee, rate, false);
      expect([after.tax, after.total]).toEqual([before.tax, before.total]);
    }
  });

  it("charges nothing on an empty basket, or at a rate of zero", () => {
    expect(taxOnLines([], 0, 0.1, false).total).toBe(0);
    const free = taxOnLines([10, 20], 1, 0, false);
    expect([free.tax, free.total, free.perLine]).toEqual([0, 31, [0, 0]]);
  });
});

describe("which way round an order's tax ran", () => {
  it("reads it back from the figures, since no column records it", () => {
    // added on: total = subtotal + fee + tax
    expect(taxWasIncluded({ subtotal: 12, fee: 1, tax: 1.3, total: 14.3 })).toBe(false);
    // included: the tax is already inside subtotal + fee
    expect(taxWasIncluded({ subtotal: 12, fee: 1, tax: 1.18, total: 13 })).toBe(true);
  });

  it("says no when there was no tax", () => {
    expect(taxWasIncluded({ subtotal: 12, fee: 1, tax: 0, total: 13 })).toBe(false);
    expect(taxWasIncluded({ subtotal: 12, fee: 1, total: 13 })).toBe(false);
  });
});

describe("an order records the tax it actually charged", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/lib/actions/orders.ts"), "utf8");

  it("writes the included figure too, not just the added-on one", () => {
    /* THE BUG: this passed taxed.tax, which is 0 when prices already
       include tax -- so such a shop wrote "no tax" onto every order while
       each of its LINES carried the real figure. The order disagreed with
       its own lines, and anything totting up the shop's liability from
       orders.tax would have read zero. */
    expect(src).toMatch(/orderColumns\(taxed\.tax \|\| taxed\.includedTax\)/);
  });
});
