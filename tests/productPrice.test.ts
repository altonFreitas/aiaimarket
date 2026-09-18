import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseNum } from "@/lib/numberInput";

/* WHAT A PRODUCT MAY BE PRICED AT.
 *
 * Two problems in one form, and the second only shows up on somebody else's
 * keyboard.
 */

const code = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("the rules live on the server, not only in the form", () => {
  const action = code("src/lib/actions/products.ts");

  it("refuses a price of zero or less", () => {
    /* The column allows price >= 0 and the only check was in the browser,
       so a save that skipped the form -- a stale tab, a second window,
       anything calling the action directly -- could list a product at
       nothing. A shop finds that out when somebody buys twenty. */
    expect(action).toMatch(/if \(!Number\.isFinite\(price\) \|\| price <= 0\)/);
    expect(action).toMatch(/throw new Error\("A product needs a price above zero\."\)/);
  });

  it("refuses a discount that is not below the price", () => {
    // A "discount" at or above the normal price is not a discount, and it
    // makes every percentage on a product card nonsense.
    expect(action).toMatch(/discount <= 0 \|\| discount >= price/);
  });

  it("writes the numbers it checked, not the ones it was handed", () => {
    // Validating one value and storing another is how a check gets bypassed
    // by a refactor nobody thought was risky.
    expect(action).toMatch(/slug, price, seller_id: sellerId/);
    expect(action).toMatch(/discount_price: discount/);
    expect(action).not.toMatch(/price: input\.price/);
  });
});

describe("a price typed on a Portuguese keyboard", () => {
  it("is read, not rejected", () => {
    /* A number input steps and formats in the BROWSER's locale, so "12,50"
       is what a Portuguese keyboard produces. Number() reads that as NaN,
       and the form reported "required" over a box that plainly had
       something in it. */
    expect(parseNum("12,50", 0)).toBe(12.5);
    expect(parseNum("12.50", 0)).toBe(12.5);
  });

  it("is read the same way everywhere the form looks at it", () => {
    /* The validation and the save must agree. Parsing one way to decide
       whether to save and another way to decide WHAT to save is how a form
       passes its own check and stores something else. */
    const form = code("src/components/admin/ProductForm.tsx");
    expect(form).not.toMatch(/Number\(f\.price\)/);
    expect(form).not.toMatch(/Number\(discountPrice\)/);
    expect(form).toMatch(/parseNum\(f\.price, 0\)/);
    expect(form).toMatch(/price: parseNum\(f\.price, 0\)/);
  });

  it("keeps the quantity a whole number that cannot go negative", () => {
    const form = code("src/components/admin/ProductForm.tsx");
    expect(form).toMatch(/qty: Math\.max\(0, Math\.floor\(parseNum\(f\.qty, 0\)\)\)/);
  });
});
