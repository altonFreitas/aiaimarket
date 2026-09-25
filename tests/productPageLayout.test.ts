import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const PDP = read("src/app/p/[slug]/page.tsx");
const CARD = read("src/components/ProductInteractive.tsx");
const CSS = read("src/app/globals.css");

/* THE BUY CARD, REBUILT.
 *
 * It was a label-and-value table headed "ALL ANSWERS, HERE" -- PRICE,
 * SIZE, AVAILABLE down the left and the answers down the right -- with
 * the buttons stacked under it and the product's name outside the card
 * entirely. The right questions in the wrong shape: a table is for
 * comparing rows, and nobody compares the price of a thing with its size.
 *
 * It reads top to bottom now, and it is pinned. */

describe("what the card says, in what order", () => {
  const order = [
    "buybox-nm", "buybox-rate", "buybox-price", "buybox-seller",
    "buybox-opt", "buybox-stock", "buybox-buy", "buybox-alt",
    "buybox-pay", "buybox-share",
  ];

  it("runs name, rating, price, seller, size, stock, buy", () => {
    /* Measured in a browser as exactly this sequence. Asserted on the
       source so a reorder has to be deliberate: what it is, what it
       costs, which one you want, how many, and the button. */
    let at = -1;
    for (const cls of order) {
      const i = CARD.indexOf(`"${cls}"`);
      expect(i, cls).toBeGreaterThan(at);
      at = i;
    }
  });

  it("carries the product's name, which used to sit outside it", () => {
    expect(CARD).toContain('<h1 className="buybox-nm">{p.name}</h1>');
    // And the page does not draw a second one.
    expect(PDP).not.toMatch(/<h1>\{p\.name\}<\/h1>/);
  });

  it("puts the quantity against the button that uses it", () => {
    // Not three rows away under a heading of its own.
    expect(CARD).toContain('<div className="buybox-buy">');
    expect(CSS).toMatch(/\.buybox-buy\{[^}]*display:flex/);
  });

  it("has no trace of the table it replaced", () => {
    for (const dead of ["aab-row", "aab-q", "aab-a", "aab-price"]) {
      expect(CARD, dead).not.toContain(dead);
    }
  });
});

describe("the price line", () => {
  it("says FROM only when the sizes really do cost different amounts", () => {
    /* discount_price is one number the shop has put on the whole
       product, so every size costs it -- and the page was reading
       "From $12.00" over a price that was $12.00 for all four sizes. */
    expect(CARD).toContain("if (p.discount_price != null && p.discount_price > 0) return false;");
  });

  it("strikes through what THIS size would have cost", () => {
    // Crossing out the product's price on a size that costs more shows a
    // saving the shopper is not getting.
    expect(CARD).toContain('<s className="buybox-was">{money(basePrice)}</s>');
  });

  it("still names the currency", () => {
    // Timor-Leste uses the dollar and a bare "$" is ambiguous.
    expect(CARD).toContain('className="buybox-cur">USD');
  });
});

describe("the card is pinned beside the page", () => {
  it("is sticky at desktop widths and not on a phone", () => {
    /* A pinned card on a 780px screen eats the screen. Measured:
       position sticky at 1280, static at 390. */
    expect(CSS).toMatch(/\.pdp-buy\{position:sticky/);
    const desktop = CSS.indexOf(".pdp-buy{position:sticky");
    const mq = CSS.lastIndexOf("@media(min-width:768px){", desktop);
    expect(mq).toBeGreaterThan(-1);
  });

  it("parks below the whole sticky stack, not below a guess", () => {
    // --chrome-h is the header and the nav added up, so this cannot
    // drift out of step with them.
    expect(CSS).toContain("top:calc(var(--chrome-h) + var(--sp-3))");
  });

  it("can scroll itself when it is taller than the window", () => {
    // A card taller than the viewport cannot be pinned at all: it would
    // scroll its own bottom off, and the button with it.
    expect(CSS).toMatch(/\.pdp-buy\{[^}]*max-height:calc\(100vh/);
    expect(CSS).toMatch(/\.pdp-buy\{[^}]*overflow-y:auto/);
  });

  it("gives the images the wider column", () => {
    expect(CSS).toContain(".pdp{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(300px,0.7fr)");
  });

  it("caps the photograph so it does not push the page off the screen", () => {
    // Uncapped, a 1/1 image in an 800px column is 800px tall -- taller
    // than the card beside it, with the description below the fold.
    expect(CSS).toContain(".gal .main{aspect-ratio:1/1;max-height:58vh}");
  });
});

describe("the long text folds", () => {
  it("uses <details>, which needs no JavaScript", () => {
    /* Keyboard-operable and screen-reader-announced for free, and the
       browser's own find-in-page opens it. */
    expect(PDP).toContain('<details className="pdp-fold" open>');
    expect(PDP.match(/<details className="pdp-fold"/g) ?? []).toHaveLength(2);
  });

  it("opens both by default", () => {
    // The page should be readable at a glance and collapsible after.
    expect(PDP).not.toMatch(/<details className="pdp-fold">/);
  });

  it("draws the + and − affordance both references use", () => {
    expect(CSS).toContain('.pdp-fold>summary::after{content:"+"');
    expect(CSS).toContain('.pdp-fold[open]>summary::after{content:"−"}');
  });

  it("draws no description fold for a product with no description", () => {
    // An empty expander is a promise of something to read.
    expect(PDP).toContain("{p.description?.trim() && (");
  });
});
