import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const CSS = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const NAV = fs.readFileSync(path.join(root, "src/lib/nav.ts"), "utf8");

/** The contents of a media query, matched by brace depth rather than by
 *  regex -- a media block contains rules, so "up to the next }" stops at
 *  the first one inside it. */
function mediaBlock(header: string, contains: string): string {
  /* There are three @media(min-width:768px) blocks in this stylesheet, so
     the header alone does not identify one -- the first holds the sidebar
     and would answer every question below with "no such rule". The block
     is the one containing the rule that turns the bar on. */
  let from = 0;
  for (;;) {
    const at = NO_COMMENTS.indexOf(header, from);
    expect(at, `a ${header} block containing ${contains}`).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = at + header.length - 1; i < NO_COMMENTS.length; i++) {
      if (NO_COMMENTS[i] === "{") depth++;
      else if (NO_COMMENTS[i] === "}" && --depth === 0) {
        const body = NO_COMMENTS.slice(at + header.length, i);
        if (body.includes(contains)) return body;
        from = at + header.length;
        break;
      }
    }
  }
}

/* The panel is desktop-only: on a phone MobileNav replaces it entirely,
   and .mega-col-feature is display:none there. Every layout rule below
   therefore has to be read out of the desktop block -- taking the first
   .mega-col-feature in the file finds the one that says "display:none",
   against which any assertion about scrolling passes or fails for the
   wrong reason. */
const DESKTOP = mediaBlock("@media(min-width:768px){", ".mainnav{display:block");

function rule(sel: string, scope: string = NO_COMMENTS): string {
  const re = new RegExp("(?:^|\\})\\s*" + sel.replace(/\./g, "\\.") + "\\{([^}]*)\\}");
  const m = re.exec(scope);
  expect(m, `the standalone ${sel} rule`).not.toBeNull();
  return m![1];
}

/* THE PANEL UNDER THE MAIN NAV, on every storefront page including
   /c/[slug] -- Header renders MegaNav and /c is not in NAV_FREE_PATHS, so
   pointing at another entry swaps the categories and the products shown
   without leaving the category page.
   Measured in a browser with 18 categories and 8 products:
     categories  250x420 box over 653px of content -> scrolls
     products    888x462 box over 1788px of content -> swipes
     scrolling the categories moved the products 0px
*/

describe("each list in the panel scrolls itself", () => {
  it("bounds the category column rather than the whole panel", () => {
    /* Before, only the panel scrolled: reaching the twentieth category
       pushed the products that are the reason for the panel off the top. */
    const groups = /\.mega-groups,\.mega-kids\{([^}]*)\}/.exec(DESKTOP);
    expect(groups, "the scrolling lists rule").not.toBeNull();
    expect(groups![1]).toMatch(/max-height:/);
    expect(groups![1]).toMatch(/overflow-y:auto/);
    // Or the page behind it scrolls once the list hits its end.
    expect(groups![1]).toMatch(/overscroll-behavior:contain/);
  });

  it("lets the product row scroll sideways", () => {
    const feat = rule(".mega-col-feature", DESKTOP);
    expect(feat).toMatch(/overflow-x:auto/);
    expect(feat).toMatch(/grid-auto-flow:column/);
    expect(feat).toMatch(/scroll-snap-type:x/);
  });

  it("does not let the product tracks shrink to fit", () => {
    /* THE BUG THIS CAUGHT. grid-auto-columns:minmax(0, X) permits a track
       to shrink all the way to zero, so all eight products squeezed
       themselves into the width of four: the row overflowed by nothing
       and there was nothing to swipe. Measured before the fix,
       scrollWidth == clientWidth == 888px; after, 1788 vs 888. A bare
       width is a real width. */
    const feat = rule(".mega-col-feature", DESKTOP);
    expect(feat).toMatch(/grid-auto-columns:calc\(/);
    expect(feat).not.toMatch(/grid-auto-columns:minmax\(0/);
  });

  it("leaves room for the horizontal scrollbar", () => {
    // overflow-x makes the other axis scrollable too; without the room a
    // horizontal bar draws over the bottom of the price line.
    expect(rule(".mega-col-feature", DESKTOP)).toMatch(/padding-bottom:/);
  });
});

describe("there is something to scroll to", () => {
  it("loads more products than the row shows", () => {
    /* Four fit. A panel that loaded exactly four had nothing past its
       right edge, so the gesture had nothing to find. */
    const n = Number(/const FEATURE_COUNT = (\d+)/.exec(NAV)?.[1] ?? NaN);
    expect(n).toBeGreaterThan(4);
    // And not so many that the shop pays for pictures nobody scrolls to.
    expect(n).toBeLessThanOrEqual(12);
  });

  it("still shows four at a time", () => {
    // The four you see are the size they have always been: a quarter of
    // the track, minus the three gaps between them.
    expect(rule(".mega-col-feature", DESKTOP)).toMatch(/\(100% - 3 \* var\(--sp-3\)\) \/ 4/);
  });
});

describe("the panel is on the category pages too", () => {
  it("does not strip the nav from /c", () => {
    /* This is what makes pointing at another category on /c/xxx swap the
       list: Header renders MegaNav on every path this does not name. */
    const free = /NAV_FREE_PATHS: readonly string\[\] = \[([^\]]*)\]/.exec(NAV);
    expect(free, "the nav-free list").not.toBeNull();
    expect(free![1]).not.toMatch(/"\/c"/);
    expect(free![1]).not.toMatch(/"\/shop"/);
  });
});
