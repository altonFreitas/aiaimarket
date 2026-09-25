import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const PDP = read("src/app/p/[slug]/page.tsx");
const CARD = read("src/components/ProductInteractive.tsx");
const RAIL = read("src/components/ProductActions.tsx");
const CSS = read("src/app/globals.css");
/* Comments talk ABOUT selectors -- this file's own notes name half the
   rules below -- so anything that looks for a declaration looks at the
   CSS with its comments taken out. Searching the raw file is how a test
   passes on the explanation of the rule it was meant to be checking. */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/* THE PRODUCT PAGE, ON FNAC'S SHAPE.
 *
 * Three columns: what the thing IS on the left (the photograph, its name,
 * its rating), what it is LIKE in the middle (Resumo and Características,
 * open, not folded), what it COSTS on the right, pinned.
 *
 * The version before this had two columns and put the summary UNDER the
 * photograph, which meant scrolling past 500px of picture to read a
 * sentence and left the middle of a wide screen empty.
 */

describe("three columns, and the buy card second in the document", () => {
  it("draws the three, each in its own wrapper", () => {
    for (const cls of ["pdp-media", "pdp-buy", "pdp-info"]) {
      expect(PDP, cls).toContain(`<div className="${cls}">`);
    }
  });

  it("puts the price ahead of the description IN THE DOCUMENT", () => {
    /* Stacked on a phone the document order is the only order there is.
       With the summary second, the price and the Add to cart button sat
       below however many words a supplier's description runs to --
       measured at 390px, a full screen of scrolling to reach the one
       control the page exists for. The grid places all three columns
       explicitly, so this costs nothing on a wide screen. */
    expect(PDP.indexOf('<div className="pdp-buy">'))
      .toBeLessThan(PDP.indexOf('<div className="pdp-info">'));
  });

  it("places all three explicitly rather than letting them fall", () => {
    /* Three children in a two-column grid auto-place as (1,1) (1,2)
       (2,1) -- which puts the price card in the middle of the left
       column and the summary alone in a short one on the right. */
    for (const rule of [
      ".pdp-media{grid-column:1;grid-row:1}",
      ".pdp-buy{grid-column:2;grid-row:1/span 2}",
      ".pdp-info{grid-column:1;grid-row:2}",
    ]) expect(RULES, rule).toContain(rule);
    for (const rule of [
      ".pdp-media{grid-column:1;grid-row:1}",
      ".pdp-info{grid-column:2;grid-row:1;margin-top:0}",
      ".pdp-buy{grid-column:3;grid-row:1}",
    ]) expect(RULES, rule).toContain(rule);
  });

  it("goes one, two, three columns as the screen widens", () => {
    expect(RULES).toContain(".pdp{display:flex;flex-direction:column");
    expect(RULES).toMatch(/\.pdp\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(300px,340px\)/);
    expect(RULES).toContain(
      ".pdp{grid-template-columns:minmax(0,1.15fr) minmax(260px,0.85fr) minmax(320px,360px)}");
  });
});

/* A MEDIA QUERY ADDS NOTHING TO SPECIFICITY.
 *
 * `.pdp{display:grid}` inside @media(min-width:768px) at line 1200 loses
 * to a plain `.pdp{display:flex}` at line 3100: same specificity, later
 * source order wins, and the wide-screen rule silently never applies.
 *
 * That happened twice while this page was being built -- once to the
 * rail, which sat under the photograph at EVERY width, and once to the
 * grid itself, which collapsed all three columns into one. Both were
 * invisible in the source and obvious the instant a browser was asked to
 * measure them. This is the invariant that would have caught either
 * without a browser: for any selector the layout redeclares, every
 * declaration inside a media query must come after every declaration
 * outside one.
 */
describe("the responsive rules can actually win", () => {
  /** Where a selector is declared, and whether that declaration sits
   *  inside an at-rule block. */
  function declarationsOf(css: string, selector: string) {
    const out: { at: number; inAtRule: boolean }[] = [];
    let depth = 0;
    /** The depths at which an open @media's body lives. */
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

  it("finds the declarations it is about to compare", () => {
    /* Without this the test below passes on a selector that has been
       renamed out of the file -- nothing to order is trivially ordered,
       which is exactly the vacuous pass this repo has been bitten by. */
    for (const sel of [".pdp", ".pdp-media-in", ".pdp-rail"]) {
      const d = declarationsOf(RULES, sel);
      expect(d.filter((x) => !x.inAtRule).length, `${sel} base`).toBeGreaterThan(0);
      expect(d.filter((x) => x.inAtRule).length, `${sel} responsive`).toBeGreaterThan(0);
    }
  });

  it("declares every base rule before the query that overrides it", () => {
    for (const sel of [".pdp", ".pdp-media-in", ".pdp-rail"]) {
      const d = declarationsOf(RULES, sel);
      const lastBase = Math.max(...d.filter((x) => !x.inAtRule).map((x) => x.at));
      const firstQuery = Math.min(...d.filter((x) => x.inAtRule).map((x) => x.at));
      expect(firstQuery, `${sel}: the @media rule must come last to win`)
        .toBeGreaterThan(lastBase);
    }
  });

  it("keeps the whole layout in one place, narrow to wide", () => {
    // The reason the two above can be reasoned about at all.
    expect(CSS).toContain("THE PRODUCT PAGE LAYOUT");
  });
});

describe("the rail beside the photograph", () => {
  it("is two buttons, both real buttons", () => {
    /* Share was a text link under the price for one version and the shop
       asked for the button back. A <button> because neither of these
       navigates anywhere. */
    // className={"rail-btn" + ...} on the heart, a plain string on the
    // other, so the brace is optional here.
    expect((RAIL.match(/<button type="button" className=\{?"rail-btn/g) ?? []).length)
      .toBe(2);
    expect(RAIL).not.toMatch(/<a[^>]*className="rail-btn/);
  });

  it("sits beside the picture only once there is room", () => {
    // A 64px column on a 390px screen costs a sixth of it.
    expect(RULES).toContain(".pdp-media-in{display:flex;flex-direction:column");
    expect(RULES).toContain(".pdp-media-in{flex-direction:row;align-items:flex-start}");
    expect(RULES).toContain(".pdp-media-in .gal{flex:1;min-width:0}");
  });

  it("says which way the heart is pointing, to a screen reader too", () => {
    expect(RAIL).toContain("aria-pressed={loved}");
    expect(RAIL).toContain('t(loved ? "unlove" : "love", lang)');
  });

  it("fills the heart from the browser's own list, not the server's", () => {
    /* The server does not know which products THIS browser hearted --
       the list is local -- so a filled heart drawn before the read
       flashes the wrong state on every page load. */
    expect(RAIL).toContain("const loved = ready && has(p.id);");
    expect(RAIL).toContain("<HeartIcon size={20} filled={loved} />");
  });

  it("draws the heart from the one component, not a second copy of the path", () => {
    // It was an inline `const HEART` in ProductCard and would have been a
    // second one here.
    const card = read("src/components/ProductCard.tsx");
    expect(card).toContain('from "./HeartIcon"');
    expect(card).not.toMatch(/const HEART\s*=/);
    expect(read("src/components/HeartIcon.tsx")).toContain("HEART_PATH");
  });
});

describe("the name and the rating sit over the photograph", () => {
  it("draws exactly one h1, and the page draws it", () => {
    /* It was inside the price card, which made the price the second
       thing read and left the left column starting with a picture of
       something unnamed. */
    expect(PDP).toContain('<h1 className="pdp-nm">{p.name}</h1>');
    expect(CARD).not.toContain("<h1");
  });

  it("only links to reviews when there are some", () => {
    expect(PDP).toContain("{average != null && (");
    expect(PDP).toContain('<div id="reviews">');
  });
});

describe("the price line, when it is a discount", () => {
  it("turns the price red and strikes the old one, the way FNAC does", () => {
    expect(CARD).toContain('"buybox-now" + (pct != null ? " is-off" : "")');
    expect(RULES).toContain(".buybox-now.is-off{color:var(--red)}");
    expect(CARD).toContain('<s className="buybox-was">{money(basePrice)}</s>');
    expect(CARD).toContain('<span className="buybox-off">-{pct}%</span>');
  });

  it("names the money saved, not only the percentage", () => {
    // "-40%" is a ratio; "$8.00" is what stays in the pocket.
    expect(CARD).toContain('{t("youSave", lang)} <b>{money(basePrice - p.discount_price!)}</b>');
  });

  it("shows none of it when there is no discount", () => {
    // pct is null then, and all four pieces hang off it.
    expect(CARD).toContain("{pct != null && (");
  });

  it("says FROM only when the sizes really do cost different amounts", () => {
    /* discount_price is one number the shop has put on the whole
       product, so every size costs it -- and the page was reading
       "From $12.00" over a price that was $12.00 for all four sizes. */
    expect(CARD).toContain("if (p.discount_price != null && p.discount_price > 0) return false;");
  });

  it("still names the currency", () => {
    // Timor-Leste uses the dollar and a bare "$" is ambiguous.
    expect(CARD).toContain('className="buybox-cur">USD');
  });
});

describe("the things you press", () => {
  it("puts the shop's own cart on Add to cart", () => {
    // Same component as the header and every catalogue card, so the
    // button and the place the goods land are the same thing.
    expect(CARD).toContain('import CartIcon from "./CartIcon"');
    expect(CARD).toMatch(/<CartIcon size=\{18\} \/>\s*\n\s*\{t\("addList", lang\)\}/);
  });

  it("keeps the quantity against the button that uses it", () => {
    expect(CARD).toContain('<div className="buybox-buy">');
    expect(RULES).toMatch(/\.buybox-buy\{[^}]*display:flex/);
  });

  it("has no trace of the table it replaced", () => {
    for (const dead of ["aab-row", "aab-q", "aab-a", "aab-price"]) {
      expect(CARD, dead).not.toContain(dead);
    }
  });
});

describe("how you can pay", () => {
  it("is a headed block with a tick against each way", () => {
    /* It was a panel of bordered rows, then a line of grey chips -- too
       loud, then too quiet. A heading and a tick each reads as
       reassurance rather than as four more facts competing with the
       price. */
    expect(CARD).toContain('<span className="buybox-lbl">{t("payAccepted", lang)}</span>');
    expect(CARD).toMatch(/buybox-pay[\s\S]{0,700}<path d="M4 12\.5l5\.5 5\.5L20 7" \/>/);
    expect(RULES).toMatch(/\.buybox-pay li svg\{[^}]*color:var\(--ok/);
  });

  it("lists only the ways this shop actually takes", () => {
    expect(CARD).toContain("payList.filter(([on]) => on)");
  });
});

describe("the summary, open beside the photograph", () => {
  it("is panels, not folds", () => {
    /* FNAC's Resumo and Características are simply there. A summary
       worth writing is worth showing, and a fold on the middle column of
       a wide screen hides text in a space nothing else wants. */
    expect(PDP).not.toContain("pdp-fold");
    expect((PDP.match(/<section className="panel pdp-sec">/g) ?? []).length).toBe(2);
  });

  it("draws neither panel when there is nothing to put in it", () => {
    // An empty heading is a promise of something to read.
    expect(PDP).toContain("{p.description?.trim() && (");
    expect(PDP).toContain("{specs.length > 0 && (");
  });

  it("caps the long text and lets the keyboard reach it", () => {
    // A supplier's four hundred words must not become the page, and a
    // region that scrolls has to be reachable without a mouse.
    expect(RULES).toMatch(/\.pdp-scroll\{max-height:\d+px;overflow-y:auto/);
    expect(PDP).toContain('<div className="pdp-scroll" tabIndex={0}');
  });

  it("shades the cut edge, and only while there is more past it", () => {
    /* A sentence sliced in half at the bottom of a box reads as a
       rendering fault rather than as an invitation to scroll. The two
       `local` layers scroll with the content and uncover the two
       `scroll` ones, so the shading appears exactly when, and where,
       there is more to see -- and never on a box short enough not to
       scroll. */
    const rule = /\.pdp-scroll, \.specs-scroll\{([\s\S]*?)\}/.exec(RULES)?.[1] ?? "";
    expect(rule, "the shaded-edge rule").not.toBe("");
    expect((rule.match(/no-repeat local/g) ?? []).length).toBe(2);
    expect((rule.match(/no-repeat scroll/g) ?? []).length).toBe(2);
  });
});

describe("the card is pinned beside the page", () => {
  it("is sticky at desktop widths and not on a phone", () => {
    /* A pinned card on a 780px screen eats the screen. Measured:
       position sticky at 1280, static at 390. */
    expect(RULES).toMatch(/\.pdp-buy\{position:sticky/);
    const desktop = RULES.indexOf(".pdp-buy{position:sticky");
    const mq = RULES.lastIndexOf("@media(min-width:768px){", desktop);
    expect(mq).toBeGreaterThan(-1);
  });

  it("parks below the whole sticky stack, not below a guess", () => {
    // --chrome-h is the header and the nav added up, so this cannot
    // drift out of step with them.
    expect(RULES).toContain("top:calc(var(--chrome-h) + var(--sp-3))");
  });

  it("can scroll itself when it is taller than the window", () => {
    // A card taller than the viewport cannot be pinned at all: it would
    // scroll its own bottom off, and the button with it.
    expect(RULES).toMatch(/\.pdp-buy\{[^}]*max-height:calc\(100vh/);
    expect(RULES).toMatch(/\.pdp-buy\{[^}]*overflow-y:auto/);
  });

  it("caps the photograph so it does not push the page off the screen", () => {
    // Uncapped, a 1/1 image in an 800px column is 800px tall -- taller
    // than the card beside it, with the description below the fold.
    expect(RULES).toContain(".gal .main{aspect-ratio:1/1;max-height:58vh}");
  });
});
