import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  lineCeiling, clampQty, mergedQty, withFreshStock, type BasketLine,
} from "@/lib/useBasket";
import { stockKey } from "@/lib/basketKey";

/* THE + BUTTON THAT COUNTED PAST THE SHELF.
 *
 * Reported from the shop: in the cart the quantity could be raised to
 * thirty for a size with ten on it. The database has always refused the
 * oversell at placement (reserve_order_stock), so nothing was ever sold
 * twice -- what it cost was a shopper filling in a delivery address for an
 * order that could not be placed.
 *
 * The product page was given a ceiling for exactly this reason. The basket
 * was not, and the same + button two screens later still counted for ever.
 * These check the rule itself rather than the shape of the code that holds
 * it.
 */

const line = (over: Partial<BasketLine> = {}): BasketLine => ({
  id: "p1", name: "Kamiza", size: "M", price: 12, qty: 1,
  seller_id: null, sellerName: null, ...over,
});

describe("what a line may be raised to", () => {
  it("is what the shelf holds", () => {
    expect(lineCeiling(line({ stock: 10 }))).toBe(10);
  });

  it("is unlimited when nothing is known", () => {
    /* A pre-order, a shop that has not counted this product, and every
       basket saved before the ceiling existed. All three must behave
       exactly as they did before, not as though they were sold out. */
    expect(lineCeiling(line())).toBe(Infinity);
    expect(lineCeiling(line({ stock: undefined }))).toBe(Infinity);
    expect(lineCeiling({ stock: Number.NaN })).toBe(Infinity);
  });

  it("takes zero seriously", () => {
    // Sold out is a real answer and not a missing one.
    expect(lineCeiling(line({ stock: 0 }))).toBe(0);
  });
});

describe("stepping the quantity", () => {
  it("stops at the shelf", () => {
    // THE BUG, in one line.
    expect(clampQty(line({ stock: 10 }), 30)).toBe(10);
    expect(clampQty(line({ stock: 10 }), 11)).toBe(10);
  });

  it("allows exactly what is there", () => {
    expect(clampQty(line({ stock: 10 }), 10)).toBe(10);
  });

  it("still refuses to go below one", () => {
    // The end that already worked, kept working.
    expect(clampQty(line({ stock: 10 }), 0)).toBe(1);
    expect(clampQty(line({ stock: 10 }), -5)).toBe(1);
  });

  it("does not cap what it has no ceiling for", () => {
    expect(clampQty(line(), 30)).toBe(30);
  });
});

describe("adding the same size twice", () => {
  it("caps the sum, not each half", () => {
    /* Three, then three again, onto a shelf holding five. Each add is
       legal on its own; the sum is not, and the cart is where it shows. */
    expect(mergedQty(line({ stock: 5, qty: 3 }), line({ stock: 5, qty: 3 }))).toBe(5);
  });

  it("adds normally below the ceiling", () => {
    expect(mergedQty(line({ stock: 10, qty: 3 }), line({ stock: 10, qty: 3 }))).toBe(6);
  });

  it("believes the more recent count", () => {
    // The line being added was read now; the one in the basket may be days
    // old. Whichever is lower is the safe answer.
    expect(mergedQty(line({ stock: 9, qty: 4 }), line({ stock: 2, qty: 4 }))).toBe(2);
    expect(mergedQty(line({ stock: 2, qty: 4 }), line({ stock: 9, qty: 4 }))).toBe(2);
  });

  it("adds without a ceiling when neither side has one", () => {
    expect(mergedQty(line({ qty: 4 }), line({ qty: 4 }))).toBe(8);
  });
});

describe("a basket that has been sitting for a day", () => {
  const basket = [
    line({ id: "a", size: "M", qty: 8, stock: 10 }),
    line({ id: "b", size: "", qty: 2, stock: 5 }),
    line({ id: "c", size: "L", qty: 3 }),
  ];

  it("pulls a line down to what is left", () => {
    const out = withFreshStock(basket, { [stockKey("a", "M")]: 3 });
    expect(out[0].qty).toBe(3);
    expect(out[0].stock).toBe(3);
  });

  it("never raises what somebody asked for", () => {
    /* The shelf was restocked. That is not permission to put four more in
       their basket on their behalf. */
    const out = withFreshStock(basket, { [stockKey("a", "M")]: 50 });
    expect(out[0].qty).toBe(8);
    expect(out[0].stock).toBe(50);
  });

  it("leaves a sold-out line for the shopper to decide about", () => {
    /* Quietly editing it to zero -- or to one -- is the basket changing an
       order nobody agreed to. It gains a ceiling of zero, the screen says
       sold out, and the person chooses. */
    const out = withFreshStock(basket, { [stockKey("b", "")]: 0 });
    expect(out[1].qty).toBe(2);
    expect(out[1].stock).toBe(0);
    expect(lineCeiling(out[1])).toBe(0);
  });

  it("leaves alone what it was told nothing about", () => {
    // An uncounted product must not become sold out because it was absent
    // from the answer.
    const out = withFreshStock(basket, { [stockKey("a", "M")]: 3 });
    expect(out[2]).toBe(basket[2]);
    expect(out[2].stock).toBeUndefined();
  });

  it("keeps the identical lines identical, so nothing re-renders for nothing", () => {
    const out = withFreshStock(basket, { [stockKey("a", "M")]: 10 });
    expect(out[0]).toBe(basket[0]);
  });

  it("tells sizes of the same product apart", () => {
    const two = [
      line({ id: "a", size: "M", qty: 9, stock: 10 }),
      line({ id: "a", size: "L", qty: 9, stock: 10 }),
    ];
    const out = withFreshStock(two, { [stockKey("a", "M")]: 2 });
    expect([out[0].qty, out[1].qty]).toEqual([2, 9]);
  });
});

describe("both screens with a stepper use the same one", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
  const BASKET = read("src/components/BasketView.tsx");
  const CHECKOUT = read("src/components/CheckoutForm.tsx");
  const STEPPER = read("src/components/QtyStepper.tsx");

  it("draws the control in one place", () => {
    /* The cart and the checkout each had their own copy, identical apart
       from a height -- which is how the ceiling came to be missing from
       both. Neither may hand-roll one again. */
    for (const [name, src] of [["cart", BASKET], ["checkout", CHECKOUT]] as const) {
      expect(src, name).toContain("<QtyStepper");
      expect(src, name).not.toMatch(/setQty\(i, l\.qty \+ 1\)/);
    }
  });

  it("disables the button rather than ignoring the press", () => {
    // A button that looks pressable and does nothing reads as broken, and
    // the shopper presses it again.
    expect(STEPPER).toMatch(/disabled=\{atCap \|\| soldOut\}/);
    expect(STEPPER).toMatch(/const atCap = capped && !soldOut && line\.qty >= cap;/);
  });

  it("says why the button is grey, in all three languages", () => {
    /* A standing statement of the ceiling, not the stockCap* messages that
       answer somebody who just asked for more than there is: in a cart the
       line sits at the ceiling without anybody having overreached, and
       "you asked for 10" when they have 10 is a complaint about nothing. */
    expect(STEPPER).toMatch(/onlyNLeftSize" : "onlyNLeft"/);
    expect(STEPPER).not.toContain("{q}");
    const I18N = read("src/lib/i18n.ts");
    for (const key of ["onlyNLeft", "onlyNLeftSize"]) {
      const m = new RegExp(key + ':\\["([^"]*)","([^"]*)","([^"]*)"\\]').exec(I18N);
      expect(m, key).not.toBeNull();
      for (const one of [m![1], m![2], m![3]]) {
        expect(one, key).toContain("{n}");
      }
    }
  });

  it("re-reads the shelf on both screens", () => {
    /* Fixing one and leaving the other is the mistake this whole task is
       about. */
    for (const [name, src] of [["cart", BASKET], ["checkout", CHECKOUT]] as const) {
      expect(src, name).toMatch(/useBasketStock\(lines, ready, applyStock\)/);
    }
  });
});

describe("the ceiling starts on the product page", () => {
  const PRODUCT = fs.readFileSync(
    path.join(process.cwd(), "src/components/ProductInteractive.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  it("sends what the shelf holds with the line", () => {
    /* WHERE THE WHOLE MECHANISM BEGINS. This screen already knew the
       ceiling -- its own + button stopped at it -- and the cart had no way
       to find out, which is why the cart's + button counted past the shelf.
       TWICE, because there are two ways off this page: Add to basket and
       Buy now. Asserting it merely appears would pass with either one of
       them stripped. */
    expect((PRODUCT.match(/stock: Number\.isFinite\(maxQty\) \? maxQty : undefined,/g) ?? []).length)
      .toBe(2);
    expect((PRODUCT.match(/\badd\(\{/g) ?? []).length).toBe(2);
  });

  it("sends nothing rather than Infinity when there is no ceiling", () => {
    // A pre-order has no ceiling, and JSON.stringify turns Infinity into
    // null -- which lineCeiling would then read as a number.
    expect(PRODUCT).toMatch(/Number\.isFinite\(maxQty\) \? maxQty : undefined/);
  });
});

describe("asking the server what is left", () => {
  const ACTION = fs.readFileSync(
    path.join(process.cwd(), "src/lib/actions/basket.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  it("bounds what one call may ask about", () => {
    // A public entry point. Without this, one request could ask for the
    // stock position of the entire catalogue.
    expect(ACTION).toMatch(/const MAX_LINES = \d+;/);
    expect(ACTION).toMatch(/\.slice\(0, MAX_LINES\)/);
  });

  it("reports a delisted product as nothing left", () => {
    // It was on sale when it went into the basket. It is not now.
    expect(ACTION).toMatch(
      /if \(p\.status !== "approved" \|\| p\.archived === true\) \{[\s\S]{0,120}?= 0;/);
  });

  it("leaves an uncounted product out rather than calling it empty", () => {
    /* Absent means "no ceiling known". Reporting an uncounted product as
       zero would empty the carts of every shop that has not started
       counting by size. */
    expect(ACTION).toMatch(/if \(Number\.isFinite\(qty\) && qty > 0\) out\[stockKey\(id, size\)\] = qty;/);
  });

  it("builds its keys with the shared function, not a second copy", () => {
    expect(ACTION).toMatch(/import \{ stockKey \} from "@\/lib\/basketKey"/);
    expect(ACTION).not.toMatch(/\\u0000/);
  });
});
