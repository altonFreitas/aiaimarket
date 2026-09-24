import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const CARD = read("src/components/ProductCard.tsx");
const PAGE = read("src/components/ProductInteractive.tsx");

/* THE BUTTON ON A CATALOGUE CARD.
 *
 * The same product, added from two places, behaved differently: the
 * product page refused to add a shoe until a size was chosen, and the card
 * added p.sizes[0] without asking -- so a shoe listed in 40, 41 and 42
 * went into the basket as a 40 because that is the order somebody typed
 * the sizes in. The shopper chose nothing, the shop got an order for a
 * size nobody asked for, and the shelf could run out of 40 while 41 and 42
 * sat there.
 */

describe("a product sold in sizes", () => {
  it("is not added from the grid at all", () => {
    expect(CARD).toContain("const needsSize = (p.sizes?.length ?? 0) > 1;");
    // Returning BEFORE preventDefault is what lets the click fall through
    // to the card's own link and open the page.
    expect(CARD).toMatch(/if \(needsSize\) return;\s*\n\s*e\.preventDefault\(\);/);
  });

  it("says so on the button, and drops the cart from it", () => {
    // A cart on a button that adds nothing to the cart is a promise it
    // does not keep.
    expect(CARD).toContain('{!needsSize && <CartIcon size={15} />}');
    expect(CARD).toContain('{t(needsSize ? "chooseSize" : "addList", lang)}');
  });

  it("treats one size as no choice at all", () => {
    // > 1, not >= 1: a product with a single size has nothing to pick.
    expect(CARD).not.toContain("(p.sizes?.length ?? 0) > 0");
  });

  it("agrees with the rule the product page has always had", () => {
    expect(PAGE).toContain("if (p.sizes?.length > 1 && !size) {");
  });
});

describe("what the basket line carries", () => {
  it("records what it would have cost, when it is on offer", () => {
    /* Checkout shows what the shopper saved from listPrice. This was the
       one place that left it out, so the same discounted product showed a
       saving when added from its page and none when added from a card. */
    expect(CARD).toContain("listPrice: p.discount_price != null ? Number(p.price) : undefined");
  });

  it("charges the discounted price, as it always did", () => {
    expect(CARD).toContain("price: Number(p.discount_price || p.price)");
  });
});
