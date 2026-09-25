import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const PDP = read("src/app/p/[slug]/page.tsx");
const BUY = read("src/components/ProductInteractive.tsx");
const GAL = read("src/components/ProductGallery.tsx");
const ACTS = read("src/components/ProductActions.tsx");
const TABS = read("src/components/ProductTabs.tsx");
const CSS = read("src/app/globals.css");
/* Comments talk ABOUT selectors -- this file's own notes name half the
   rules below -- so anything that looks for a declaration looks at the
   CSS with its comments taken out. Searching the raw file is how a test
   passes on the explanation of the rule it was meant to be checking. */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/* THE PRODUCT PAGE, ON THE SHOP'S REFERENCE DESIGN.
 *
 * The photograph with a thumbnail rail beside it on the left; the name,
 * the rating, the price, three fact tiles and the description in the
 * middle; what you choose and press on the right; and specifications,
 * reviews and shipping as tabs across the bottom.
 */

describe("four blocks, in the order a phone needs them", () => {
  it("draws all four", () => {
    expect(PDP).toContain('<div className="pdp-media">');
    for (const cls of ["pdp-info", "pdp-buy", "pdp-about"]) {
      expect(BUY, cls).toContain(`<div className="${cls}">`);
    }
  });

  it("puts the panel you press ahead of the prose IN THE DOCUMENT", () => {
    /* Stacked on a phone the document order is the only order there is.
       With the description inside .pdp-info the Add to cart button sat
       below however many words a supplier's description runs to. Split
       out and placed after the panel, the phone reads picture, name,
       price, the thing you press, and THEN the prose. Measured at 390px:
       media 199, info 486, buy 765, about 1332. */
    expect(BUY.indexOf('<div className="pdp-buy">'))
      .toBeLessThan(BUY.indexOf('<div className="pdp-about">'));
    expect(BUY.indexOf('<div className="pdp-info">'))
      .toBeLessThan(BUY.indexOf('<div className="pdp-buy">'));
  });

  it("places every block explicitly at both breakpoints", () => {
    /* Auto-placement would carry the PHONE's order into the grid, where
       it is the wrong one. A 2x2 from 768 -- picture with its
       description under it on the left, price and panel on the right --
       and three columns from 1180. */
    for (const rule of [
      ".pdp-media{grid-column:1;grid-row:1}",
      ".pdp-about{grid-column:1;grid-row:2}",
      ".pdp-info{grid-column:2;grid-row:1}",
      ".pdp-buy{grid-column:2;grid-row:2}",
    ]) expect(RULES, `768: ${rule}`).toContain(rule);
    for (const rule of [
      ".pdp-media{grid-column:1;grid-row:1/span 2}",
      ".pdp-info{grid-column:2;grid-row:1;margin-top:0}",
      ".pdp-about{grid-column:2;grid-row:2}",
      ".pdp-buy{grid-column:3;grid-row:1/span 2}",
    ]) expect(RULES, `1180: ${rule}`).toContain(rule);
  });

  it("goes one, two, three columns as the screen widens", () => {
    expect(RULES).toContain(".pdp{display:flex;flex-direction:column");
    expect(RULES).toMatch(/\.pdp\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(300px,340px\)/);
    expect(RULES).toContain(
      ".pdp{grid-template-columns:minmax(0,1fr) minmax(300px,1.1fr) minmax(300px,340px)}");
  });
});

/* A MEDIA QUERY ADDS NOTHING TO SPECIFICITY.
 *
 * `.pdp{display:grid}` inside @media(min-width:768px) at line 1200 loses
 * to a plain `.pdp{display:flex}` at line 3100: same specificity, later
 * source order wins, and the wide-screen rule silently never applies.
 *
 * That happened twice while this page was being built -- once to a rail
 * that sat under the photograph at EVERY width, and once to the grid
 * itself, which collapsed all three columns into one. Both were
 * invisible in the source and obvious the instant a browser was asked to
 * measure them. This is the invariant that catches either without one.
 */
describe("the responsive rules can actually win", () => {
  /** Where a selector is declared, and whether that declaration sits
   *  inside an at-rule block. */
  function declarationsOf(css: string, selector: string) {
    const out: { at: number; inAtRule: boolean }[] = [];
    let depth = 0;
    const atRule: number[] = [];
    for (let i = 0; i < css.length; i++) {
      if (css.startsWith("@media", i)) atRule.push(depth + 1);
      const c = css[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        while (atRule.length && atRule[atRule.length - 1] > depth) atRule.pop();
      } else if (css.startsWith(selector + "{", i)
        && !/[\w-]/.test(css[i - 1] ?? " ")) {
        out.push({ at: i, inAtRule: atRule.length > 0 });
      }
    }
    return out;
  }

  const GUARDED = [".pdp", ".gal", ".spec-cols"];

  it("finds the declarations it is about to compare", () => {
    /* Without this the test below passes on a selector that has been
       renamed out of the file -- nothing to order is trivially ordered,
       which is exactly the vacuous pass this repo has been bitten by. */
    for (const sel of GUARDED) {
      const d = declarationsOf(RULES, sel);
      expect(d.filter((x) => !x.inAtRule).length, `${sel} base`).toBeGreaterThan(0);
      expect(d.filter((x) => x.inAtRule).length, `${sel} responsive`).toBeGreaterThan(0);
    }
  });

  it("declares every base rule before the query that overrides it", () => {
    for (const sel of GUARDED) {
      const d = declarationsOf(RULES, sel);
      const lastBase = Math.max(...d.filter((x) => !x.inAtRule).map((x) => x.at));
      const firstQuery = Math.min(...d.filter((x) => x.inAtRule).map((x) => x.at));
      expect(firstQuery, `${sel}: the @media rule must come last to win`)
        .toBeGreaterThan(lastBase);
    }
  });

  it("keeps the whole layout in one place, narrow to wide", () => {
    expect(CSS).toContain("THE PRODUCT PAGE LAYOUT");
  });
});

describe("the gallery", () => {
  it("runs its thumbnails down the side of the picture, and under it on a phone", () => {
    // A 64px column costs a sixth of a 390px screen.
    expect(RULES).toMatch(/@media\(min-width:768px\)\{\s*\.gal\{display:flex/);
    expect(RULES).toContain(".thumbs{order:1;flex-direction:column");
    expect(RULES).toContain(".gal .main{order:2;flex:1;min-width:0}");
  });

  it("puts the picture before its own navigation in the document", () => {
    /* order:2 on the picture is a VISUAL move only. The thumbnails come
       after it in the source because the picture is the content and they
       are navigation for it -- which is the order a screen reader and a
       keyboard get. */
    expect(GAL.indexOf('className={"main"')).toBeLessThan(GAL.indexOf('className="thumbs"'));
  });

  it("draws arrows, dots and thumbnails only when there is somewhere to go", () => {
    /* One photograph and all three are furniture around a thing that
       cannot change. The arrows carry a second condition -- they are
       also hidden while the picture is zoomed, where they would fight
       the drag. */
    expect((GAL.match(/\{list\.length > 1 && /g) ?? []).length).toBe(3);
    expect(GAL).toContain("{list.length > 1 && !zoomed && (");
  });

  it("keeps the arrows out of a screen reader's way", () => {
    /* The thumbnails are the same navigation, already labelled.
       Announcing both makes one gallery sound like two.
       BOTH of them, counted. Asserting the string was present passed
       with one arrow still in the tab order -- a mutation proved it, and
       a half-fixed keyboard trap is the kind of thing that only shows up
       to the person using the keyboard. */
    expect(GAL).toContain('className="gal-arw gal-arw-l" aria-hidden="true"');
    expect(GAL).toContain('className="gal-arw gal-arw-r" aria-hidden="true"');
    expect((GAL.match(/tabIndex=\{-1\}/g) ?? []).length).toBe(2);
  });

  it("hides the arrows until a real pointer is over the picture", () => {
    // On a phone they would cover the photograph, and a thumbnail is the
    // gesture there.
    expect(RULES).toMatch(/@media \(hover:hover\) and \(pointer:fine\)\{\s*\.gal-arw\{opacity:0/);
  });

  it("wraps rather than going dead at the ends", () => {
    // Arrows that stop responding read as a gallery that has broken.
    expect(GAL).toContain("selectImage((i + d + list.length) % list.length)");
  });
});

describe("the heart and the share button, on the photograph", () => {
  it("are two real buttons over the picture, not a rail beside it", () => {
    expect((ACTS.match(/<button type="button" className=\{?"gal-act/g) ?? []).length).toBe(2);
    expect(ACTS).not.toContain("pdp-rail");
    expect(PDP).toContain("actions={");
  });

  it("sit on a disc, because a photograph can be any colour", () => {
    expect(RULES).toMatch(/\.gal-act\{[^}]*background:rgba\(255,255,255,\.94\)/);
  });

  it("says which way the heart is pointing, to a screen reader too", () => {
    expect(ACTS).toContain("aria-pressed={loved}");
    expect(ACTS).toContain('t(loved ? "unlove" : "love", lang)');
  });

  it("fills the heart from the browser's own list, not the server's", () => {
    /* The server does not know which products THIS browser hearted --
       the list is local -- so a filled heart drawn before the read
       flashes the wrong state on every page load. */
    expect(ACTS).toContain("const loved = ready && has(p.id);");
    expect(ACTS).toContain("<HeartIcon size={18} filled={loved} />");
  });

  it("only claims a best seller when the rating earns it", () => {
    /* "Best seller" on a product nobody has bought is the kind of claim
       that costs a shop its credibility. Drawn off the same rating the
       stars come from, with a floor on the number of reviews. */
    expect(PDP).toContain("average >= 4.5 && (Number(p.rating_count) || 0) >= 5");
  });
});

describe("the middle column", () => {
  it("draws exactly one h1, and the price under it", () => {
    expect(BUY).toContain('<h1 className="pdp-nm">{p.name}</h1>');
    expect(PDP).not.toContain("<h1");
    expect(BUY.indexOf('className="pdp-nm"'))
      .toBeLessThan(BUY.indexOf('<div className="buybox-price">'));
  });

  it("puts the rating and the stock on one line", () => {
    // "Is it any good" and "can I have it" are asked in the same breath.
    expect(BUY).toContain('<div className="pdp-meta">');
    expect(BUY).toContain('<span className={"pdp-stock " + STOCK_CLS[p.stock_status]}>');
  });

  it("picks its three tiles by meaning, not by position", () => {
    /* "The first three specs" would show a sofa's Width, Depth and
       Height -- true, and not what a shopper scans for. */
    expect(PDP).toContain('const TILE_ORDER = ["material", "fit", "gender"');
    expect(read("src/lib/data/productSpecs.ts")).toContain("slug: string;");
  });

  it("draws the ticked one-liners only when the listing has some", () => {
    expect(BUY).toContain("{highlights.length > 0 && (");
    expect(BUY).toContain("const highlights: string[] = Array.isArray(p.highlights)");
  });

  it("caps the long text and lets the keyboard reach it", () => {
    expect(RULES).toMatch(/\.pdp-scroll\{max-height:\d+px;overflow-y:auto/);
    expect(BUY).toContain('<div className="pdp-scroll" tabIndex={0}');
  });
});

describe("the price, when it is a discount", () => {
  it("turns red and strikes the old one", () => {
    expect(BUY).toContain('"buybox-now" + (pct != null ? " is-off" : "")');
    expect(RULES).toContain(".buybox-now.is-off{color:var(--red)}");
    expect(BUY).toContain('<s className="buybox-was">{money(basePrice)}</s>');
    expect(BUY).toContain('<span className="buybox-off">{pct}% OFF</span>');
  });

  it("names the money saved, not only the percentage", () => {
    // "33% OFF" is a ratio; "$6.00" is what stays in the pocket.
    expect(BUY).toContain('{t("youSave", lang)} <b>{money(basePrice - p.discount_price!)}</b>');
  });

  it("says FROM only when the sizes really do cost different amounts", () => {
    expect(BUY).toContain("if (p.discount_price != null && p.discount_price > 0) return false;");
  });

  it("still names the currency", () => {
    expect(BUY).toContain('className="buybox-cur">USD');
  });

  it("lives in the middle column and still follows the size picker", () => {
    /* THE REASON THIS COMPONENT RENDERS TWO COLUMNS. The reference puts
       the price under the title and the size buttons in the panel; this
       shop's prices follow the size, so the two cannot be separate
       components with separate state. */
    const priceAt = BUY.indexOf('<div className="buybox-price">');
    const infoAt = BUY.indexOf('<div className="pdp-info">');
    const buyAt = BUY.indexOf('<div className="pdp-buy">');
    expect(priceAt).toBeGreaterThan(infoAt);
    expect(priceAt).toBeLessThan(buyAt);
    expect(BUY).toContain("const sizePrice = size != null ? sizePrices?.[size] : undefined;");
  });
});

describe("the buy panel", () => {
  it("offers the colours, and says which one even when there is no choice", () => {
    expect(BUY).toContain('{colors.length > 0 && (');
    expect(BUY).toContain('{t("colorLabel", lang)}: <b>');
  });

  it("does not pretend one colour is a choice", () => {
    /* A button that cannot change anything still takes a tab stop and
       still invites a press that does nothing. */
    expect(BUY).toContain("const only = colors.length === 1;");
    expect(BUY).toContain("disabled={only}");
  });

  it("rings the chosen swatch from outside", () => {
    // An inner border would vanish into a pale colour, so a chosen white
    // swatch and an unchosen one would look identical.
    expect(RULES).toContain(".swatch.is-on{border-color:var(--ink)}");
  });

  it("puts the shop's own cart on Add to cart", () => {
    expect(BUY).toContain('import CartIcon from "./CartIcon"');
    expect(BUY).toMatch(/<CartIcon size=\{18\} \/>\s*\n\s*\{t\("addList", lang\)\}/);
  });

  it("keeps the quantity against the button that uses it", () => {
    expect(BUY).toContain('<div className="buybox-buy">');
    expect(RULES).toMatch(/\.buybox-buy\{[^}]*display:flex/);
  });

  it("has no trace of the table it replaced", () => {
    for (const dead of ["aab-row", "aab-q", "aab-a", "aab-price"]) {
      expect(BUY, dead).not.toContain(dead);
    }
  });
});

describe("what the shop promises about delivery", () => {
  it("makes no promise the settings do not support", () => {
    /* The reference reads "Free shipping on orders over $50". This shop
       has no such threshold, and a shopper who read it and was then
       charged for delivery would have been misled by the website. */
    /* THE CODE, NOT THE FILE. The comment at the top of that module
       quotes the reference's own "Free shipping on orders over $50" to
       explain why it is not implemented -- so searching the whole file
       for that phrase fails on the explanation of its own absence.
       Same trap, other way round, as the vacuous passes this repo has
       hit twice: read the code, never the prose around it. */
    const PROM = read("src/lib/deliveryPromise.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    expect(PROM).not.toMatch(/\bover \$?\d/);
    /* Free ONLY when a zone's fee is genuinely zero -- and the TEST is
       the ternary, not the two halves of it. Asserting each string
       separately passed with the condition replaced by `true`, because
       `Number(best.fee) === 0` also appears in bestZoneFee below. */
    expect(PROM).toMatch(
      /Number\(best\.fee\) === 0\s*\?\s*\{ kind: "delivery", key: "promiseFreeTo"/);
  });

  it("says nothing at all rather than a default", () => {
    // A setting that is not there produces no line.
    expect(read("src/lib/deliveryPromise.ts")).toContain("if (settings.pickup) out.push");
    expect(BUY).toContain("{promises.length > 0 && (");
  });

  it("takes the returns window from the same setting the policy prints", () => {
    // Two places stating a window and one of them guessing is how a shop
    // ends up arguing with a customer holding a screenshot.
    expect(read("src/lib/deliveryPromise.ts")).toContain("settings.legal_return_days");
    expect(TABS).toContain("settings.legal_return_days");
  });
});

describe("the tabs under the fold", () => {
  it("is three tabs with one always open", () => {
    /* A page where every panel can be shut is a page that can show
       nothing at all. */
    expect(TABS).toContain('useState<"specs" | "reviews" | "ship">(');
    expect(TABS).toContain('specs.length ? "specs" : "reviews"');
  });

  it("behaves like tabs, not like a row of buttons that looks like them", () => {
    expect(TABS).toContain('role="tablist"');
    expect(TABS).toContain('role="tab"');
    expect(TABS).toContain('role="tabpanel"');
    expect(TABS).toContain("aria-selected={tab === x.id}");
  });

  it("hides the Specifications tab when nothing has been answered", () => {
    // Opening on an empty panel is a page that looks broken before it
    // has been touched.
    expect(TABS).toContain("...(specs.length ? [{ id: \"specs\" as const");
  });

  it("carries the payment methods, which left the buy panel", () => {
    /* Three blocks in the buy panel was three blocks competing with the
       button; here they sit beside the fees and the returns window,
       which is the same question asked three ways. */
    expect(TABS).toContain('[pay.cod, "pm_cod"]');
    expect(BUY).not.toContain("buybox-pay");
  });

  it("does not print a price for a zone the shop quotes for", () => {
    // $0.00 against a quote-on-request zone reads as free.
    expect(TABS).toContain('z.quote ? t("quoteOnRequest", lang) : money(Number(z.fee))');
  });
});
