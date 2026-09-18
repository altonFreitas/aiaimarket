import { describe, it, expect } from "vitest";
import { rateFor, taxOnLines } from "@/lib/tax";
import { taxOn } from "@/lib/money";

/* TAX THAT DIFFERS BY CATEGORY.
 *
 * The arithmetic here decides what a customer is charged and what the shop
 * owes, so every case below is one where being a cent or a tenth out is a
 * real error rather than a tidiness question.
 */

describe("which rate applies to a line", () => {
  it("uses the shop's rate when the category has not been given one", () => {
    expect(rateFor(null, 0.1)).toBe(0.1);
    expect(rateFor(undefined, 0.1)).toBe(0.1);
  });

  it("treats a category set to zero as a decision, not as an absence", () => {
    /* THE DISTINCTION THE WHOLE FEATURE RESTS ON. Zero-rated food has to
       stay zero-rated when the shop raises its own rate from 10% to 12%.
       Reading 0 as "not answered" would tax it at 12% that afternoon, with
       nothing on any screen having changed. */
    expect(rateFor(0, 0.1)).toBe(0);
  });

  it("falls back rather than trusting a rate outside 0-1", () => {
    // The column is a FRACTION. A 10 in it is somebody typing a percentage
    // into the wrong box, and charging 1000% is not the safe way to fail.
    expect(rateFor(10, 0.1)).toBe(0.1);
    expect(rateFor(-0.5, 0.1)).toBe(0.1);
    expect(rateFor(Number.NaN, 0.1)).toBe(0.1);
  });

  it("charges nothing when the shop charges nothing and nobody overrode it", () => {
    expect(rateFor(null, 0)).toBe(0);
    expect(rateFor(0.05, 0)).toBe(0.05);   // a category may tax where the shop does not
  });
});

describe("an order whose lines are taxed differently", () => {
  it("taxes each line at its own rate rather than averaging", () => {
    /* $100 at 10% and $100 at 0%. An average rate of 5% on $200 gives $10 --
       the right answer here by coincidence, and wrong the moment the two
       lines are not equal in value. */
    const out = taxOnLines(
      [{ value: 100, categoryRate: 0.1 }, { value: 100, categoryRate: 0 }],
      0, 0.1, false);
    expect(out.tax).toBe(10);
    expect(out.perLine).toEqual([10, 0]);
    expect(out.total).toBe(210);
  });

  it("proves the averaging bug would be wrong on unequal lines", () => {
    // $300 at 10% and $100 at 0%: correct is $30. An average of 5% on $400
    // would be $20, and the shop would owe the difference.
    const out = taxOnLines(
      [{ value: 300, categoryRate: 0.1 }, { value: 100, categoryRate: 0 }],
      0, 0.1, false);
    expect(out.tax).toBe(30);
  });

  it("taxes the delivery fee at the shop's rate", () => {
    // The fee is not goods and belongs to no category.
    const out = taxOnLines([{ value: 100, categoryRate: 0 }], 10, 0.1, false);
    expect(out.tax).toBe(1);        // nothing on the goods, 10% of the fee
    expect(out.total).toBe(111);
  });

  it("works tax-inclusive, which is not the same sum backwards", () => {
    /* On a $110 tax-inclusive price at 10%, the tax already inside is $10
       (110/1.1 = 100), NOT $11. Getting this backwards overstates what the
       shop owes by a tenth on every order, and it is the commonest error in
       hand-written tax code. */
    const out = taxOnLines([{ value: 110, categoryRate: 0.1 }], 0, 0.1, true);
    expect(out.includedTax).toBe(10);
    expect(out.tax).toBe(0);
    expect(out.total).toBe(110);
    expect(out.net).toBe(100);
  });

  it("adds up: the lines sum to the order's tax exactly", () => {
    // Three awkward values at two rates, where a sloppy apportionment
    // leaves a stray cent.
    const out = taxOnLines([
      { value: 33.33, categoryRate: 0.1 },
      { value: 33.33, categoryRate: 0.1 },
      { value: 33.34, categoryRate: 0.025 },
    ], 0, 0.1, false);
    const summed = Math.round(out.perLine.reduce((a, n) => a + n, 0) * 100) / 100;
    expect(summed).toBe(out.tax);
  });

  it("reports one rate only when one rate is the truth", () => {
    /* The checkout prints "Tax (10%)" from this. An earlier version asked
       only whether the LINES agreed, which printed "Tax (10%)" over an
       order of zero-rated food whose only tax was ten cents on the
       delivery -- a true statement about the fee, printed as though it
       described the order. */
    const same = taxOnLines(
      [{ value: 10, categoryRate: 0.1 }, { value: 10, categoryRate: 0.1 }], 1, 0.1, false);
    expect(same.uniformRate).toBe(0.1);

    const mixed = taxOnLines(
      [{ value: 10, categoryRate: 0.1 }, { value: 10, categoryRate: 0 }], 0, 0.1, false);
    expect(mixed.uniformRate).toBeNull();

    // THE CASE THAT CAUGHT IT: zero-rated goods, a taxed delivery fee.
    // No single percentage describes the order, so none is offered.
    const zeroGoodsTaxedFee = taxOnLines(
      [{ value: 12, categoryRate: 0 }], 1, 0.1, false);
    expect(zeroGoodsTaxedFee.uniformRate).toBeNull();
    expect(zeroGoodsTaxedFee.tax).toBe(0.1);

    // The same order COLLECTED, with no fee, is honestly 0%.
    const zeroGoodsNoFee = taxOnLines([{ value: 12, categoryRate: 0 }], 0, 0.1, false);
    expect(zeroGoodsNoFee.uniformRate).toBe(0);
    expect(zeroGoodsNoFee.tax).toBe(0);
  });

  it("agrees with the single-rate function when nothing overrides", () => {
    /* The old behaviour has to survive: a shop with no per-category rates
       must be charged exactly what it was charged before this existed. */
    for (const [sub, fee, rate] of [[12, 1, 0.1], [99.99, 2.5, 0.025], [40, 0, 0]] as const) {
      const before = taxOn(sub, fee, rate, false);
      const after = taxOnLines([{ value: sub }], fee, rate, false);
      expect([after.tax, after.total]).toEqual([before.tax, before.total]);
    }
  });

  it("charges nothing on an empty basket", () => {
    const out = taxOnLines([], 0, 0.1, false);
    expect([out.tax, out.total, out.perLine]).toEqual([0, 0, []]);
  });
});

import { categoryTaxRates } from "@/lib/tax";
import fs from "node:fs";
import path from "node:path";

describe("the map the checkout prices with", () => {
  it("includes a category whose rate is zero", () => {
    // Zero is an answer. Dropping it would silently tax zero-rated goods at
    // the shop's rate, which is the bug the whole null/0 distinction exists
    // to prevent.
    expect(categoryTaxRates([{ id: "food", tax_rate: 0 }])).toEqual({ food: 0 });
  });

  it("leaves out a category that has never been given one", () => {
    // Absent means "ask the shop's rate", which is what rateFor() does with
    // an undefined lookup.
    expect(categoryTaxRates([{ id: "a", tax_rate: null }, { id: "b" }])).toEqual({});
  });

  it("drops a rate the column should never have held", () => {
    expect(categoryTaxRates([{ id: "x", tax_rate: 10 }])).toEqual({});
  });
});

describe("the checkout charges what the server will", () => {
  const code = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  it("adds tax into the total the shopper agrees to", () => {
    /* THE BUG. placeOrder() has taxed every order since the tax columns
       existed, and this summary added up goods and delivery only -- so a
       shop charging 10% quoted $13.00 and wrote $14.30 to the order. The
       customer agreed to one number and was billed another. */
    const co = code("src/components/CheckoutForm.tsx");
    expect(co).toMatch(/const taxed = taxOnLines\(/);
    expect(co).toMatch(/const total = taxed\.total;/);
    expect(co).not.toMatch(/const total = subtotal \+ fee/);
  });

  it("uses the same function on both sides", () => {
    // One implementation, so a change to the arithmetic cannot move the
    // quote without moving the charge.
    expect(code("src/lib/actions/orders.ts")).toMatch(/taxOnLines\(/);
  });

  it("takes the rate off the product's category, never off the basket", () => {
    /* A basket that could name its own tax rate could name zero. The server
       reads category_id from the PRODUCT row it already loaded. */
    const orders = code("src/lib/actions/orders.ts");
    expect(orders).toMatch(/from\("categories"\)\.select\("id, tax_rate"\)/);
    expect(orders).toMatch(/byId\.get\(i\.product_id\)/);
  });

  it("shows the tax on the order a customer looks up afterwards", () => {
    // Subtotal + delivery did not add up to the total on the tracking page
    // either, by exactly the tax.
    expect(code("src/components/TrackForm.tsx")).toMatch(/Number\(o\.tax\) > 0/);
  });
});
