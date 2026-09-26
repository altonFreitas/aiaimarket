import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { acceptedPayments, deliveryNote } from "@/lib/payMethods";

/* THE CART, ON THE REFERENCE'S SHAPE.
 *
 * The reference is a slide-over sheet: suggestions down the left, the
 * lines beside them, a "Free shipping on orders over $50!" banner, then
 * Shipping $9.99, a Total, checkout and six card logos.
 *
 * Two of those are numbers this shop does not have. Delivery is priced by
 * ZONE and the zone is chosen at CHECKOUT, so the cart knows neither the
 * fee nor the total -- and there is no spend threshold anywhere in the
 * settings for a "free over $50" to come from. These guard the parts that
 * would otherwise quietly become invented.
 */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const CART = code("src/components/BasketView.tsx");
const CSS = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const I18N = read("src/lib/i18n.ts");
const label = (id: string) => "Zone " + id;

/** The @media block whose body contains `needle`, with the query text that
 * guards it. Anchoring on a comment does not work -- CSS has its comments
 * stripped -- and anchoring on the raw string means a guard that passes
 * from a rule sitting at base width, where two columns would wreck a
 * phone. So the block is found by matching braces. */
function mediaBlock(needle: string): { query: string; body: string } | null {
  for (const m of CSS.matchAll(/@media ([^{]+)\{/g)) {
    const open = m.index! + m[0].length;
    let depth = 1, i = open;
    while (i < CSS.length && depth > 0) {
      if (CSS[i] === "{") depth++;
      else if (CSS[i] === "}") depth--;
      i++;
    }
    const body = CSS.slice(open, i - 1);
    if (body.includes(needle)) return { query: m[1], body };
  }
  return null;
}

describe("what the cart can say about delivery", () => {
  it("names the free zone when there is one", () => {
    // "Free delivery to Central Dili" is an offer this shop actually
    // makes, unlike a spend threshold it has never had.
    const note = deliveryNote(
      [{ id: "dili_center", fee: 0, quote: false },
       { id: "dili_outskirts", fee: 2.5, quote: false }], label);
    expect(note).toEqual({ key: "cartFreeZone", vars: { zone: "Zone dili_center" } });
  });

  it("quotes the cheapest zone when none is free", () => {
    const note = deliveryNote(
      [{ id: "a", fee: 3, quote: false }, { id: "b", fee: 1.5, quote: false }], label);
    expect(note).toEqual({ key: "cartDeliveryFrom", vars: { fee: "1.5" } });
  });

  it("says nothing when every zone is quoted case by case", () => {
    /* A shop that prices every delivery on request has no "from" figure,
       and inventing one is the failure this whole function exists to
       avoid. */
    expect(deliveryNote([{ id: "a", fee: 0, quote: true }], label)).toBeNull();
    expect(deliveryNote([], label)).toBeNull();
  });

  it("does not treat a quoted zone's zero fee as free", () => {
    // zones carry fee 0 when the delivery is quoted, so the obvious
    // version of this reads "free delivery" off a delivery that will be
    // charged for.
    const note = deliveryNote(
      [{ id: "quoted", fee: 0, quote: true }, { id: "real", fee: 2, quote: false }], label);
    expect(note).toEqual({ key: "cartDeliveryFrom", vars: { fee: "2" } });
  });

  it("has no threshold anywhere to invent one from", () => {
    /* The reference's banner. If a spend threshold ever appears it has to
       come from a setting, and there is no such setting. */
    expect(CART).not.toMatch(/\b50\b|threshold|freeOver|spendMore/i);
  });
});

describe("the cart does not quote a total it cannot honour", () => {
  it("shows a subtotal and says where the rest comes from", () => {
    expect(CART).toMatch(/t\("subtotal", lang\)/);
    expect(CART).toMatch(/t\("cartDeliveryAtCheckout", lang\)/);
  });

  it("prints no total", () => {
    /* Delivery is added one screen later, so a "Total" here is a number
       about to change -- which is worse than asking somebody to go one
       screen further. */
    expect(CART).not.toMatch(/t\("total", lang\)/);
  });
});

describe("the suggestions", () => {
  it("leave out what is already in the basket", () => {
    // Suggesting what somebody has just put in their cart is the clearest
    // way to look like a machine.
    expect(CART).toMatch(/const inBasket = new Set\(lines\.map\(\(l\) => l\.id\)\)/);
    expect(CART).toMatch(/suggestions\.filter\(\(p\) => !inBasket\.has\(p\.id\)\)\.slice\(0, \d+\)/);
  });

  it("disappear rather than leaving a heading over nothing", () => {
    expect(CART).toMatch(/\{suggest\.length > 0 && \(/);
  });

  it("cannot render as a poster", () => {
    /* They did: with the wide grid track first the suggestions took it and
       each image, being width:100% of a square, came out 990px tall. */
    const rule = /\.cart-sugg-item img\{([^}]*)\}/.exec(CSS);
    expect(rule, "the suggestion image rule").not.toBeNull();
    expect(rule![1]).toContain("max-height");
  });
});

describe("the two columns", () => {
  it("gives the wide track to the cart, not to the suggestions", () => {
    /* The narrow track is FIRST because the suggestions are ordered into
       it. With 1fr first they took the wide column and the cart was
       squeezed into 240px. */
    const block = mediaBlock(".cart-cols{grid-template-columns");
    expect(block, "a width rule giving .cart-cols its tracks").not.toBeNull();
    // Two tracks only once there is room for two.
    expect(block!.query).toMatch(/min-width:\s*\d+px/);
    const rule = /\.cart-cols\{grid-template-columns:([^;}]*)/.exec(block!.body);
    expect(rule![1].trim()).toMatch(/^\d+px minmax\(0,1fr\)$/);
    // ...and nowhere else, or the phone gets them too.
    expect([...CSS.matchAll(/\.cart-cols\{[^}]*grid-template-columns/g)]).toHaveLength(1);
  });

  it("puts the basket first when the columns stack", () => {
    // On a phone the thing somebody came for is their own basket, so the
    // lines are first in source order and the suggestions are re-ordered
    // above them only at width.
    expect(CART.indexOf('className="cart-main"'))
      .toBeLessThan(CART.indexOf('className="cart-side"'));
    // The re-order is a wide-screen rule. At base width it would put the
    // suggestions above the basket on a phone, which is the arrangement
    // this test exists to prevent.
    const block = mediaBlock(".cart-main{order:");
    expect(block, "a width rule re-ordering the columns").not.toBeNull();
    expect(block!.query).toMatch(/min-width:\s*\d+px/);
    expect(block!.body).toMatch(/\.cart-main\{order:2\}/);
    expect(block!.body).toMatch(/\.cart-side\{order:1/);
  });
});

describe("the per-line money", () => {
  it("says the unit price only when it adds something", () => {
    // "$12.00 each" under "$12.00" is the same number twice.
    expect(CART).toMatch(/\{l\.qty > 1 && \(/);
  });
});

describe("the payment methods", () => {
  it("are the shop's, from the one list the footer also prints", () => {
    const PAGE = code("src/app/list/page.tsx");
    expect(PAGE).toMatch(/acceptedPayments\(settings, cardPaymentAvailable\(\)\)/);
    expect(CART).not.toMatch(/\bvisa\b|mastercard|paypal|amex/i);
  });

  it("always includes cash on delivery", () => {
    expect(acceptedPayments({ pickup: false, banks: [], wallets: [] }, false))
      .toContain("pm_cod");
  });
});

describe("the cart's wording exists in all three languages", () => {
  it("says the same thing in Tetun, Portuguese and English", () => {
    for (const key of ["each", "cartSuggested", "cartFreeZone",
                       "cartDeliveryFrom", "cartDeliveryAtCheckout"]) {
      const m = new RegExp(key + ':\\["([^"]*)","([^"]*)","([^"]*)"\\]').exec(I18N);
      expect(m, key).not.toBeNull();
      for (const one of [m![1], m![2], m![3]]) expect(one.length, key).toBeGreaterThan(0);
    }
  });

  it("keeps the placeholders the code substitutes", () => {
    // A translation that drops {zone} or {fee} prints a sentence with a
    // hole in it.
    // EVERY language, not any one of them: arrayContaining passed here
    // with {zone} gutted out of both Tetun and Portuguese.
    for (const [key, hole] of [["cartFreeZone", "{zone}"], ["cartDeliveryFrom", "{fee}"]]) {
      const all = new RegExp(key + ':\\["([^"]*)","([^"]*)","([^"]*)"\\]').exec(I18N)!.slice(1);
      expect(all, key).toHaveLength(3);
      for (const one of all) expect([key, one], key).toEqual([key, expect.stringContaining(hole)]);
    }
  });
});
