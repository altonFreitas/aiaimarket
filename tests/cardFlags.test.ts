import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* THE TWO PILLS IN THE TOP-RIGHT CORNER OF A PRODUCT CARD.
 *
 * "BEST SELLER" and "-40%" are separate facts about a product and a card
 * may carry either, both or neither. They used to be drawn by two different
 * components that had never been introduced:
 *
 *   - the discount pill by ProductCard, inside the photo;
 *   - the best-seller flag by ProductSection, on a wrapper DIV that was a
 *     SIBLING of the card.
 *
 * Both asked for top:8px right:8px, so on a card that was both a best
 * seller and on sale they landed on the same square and overlapped. The row
 * read "BEST -40%" -- one amber pill, with the back half of "SELLER"
 * underneath the discount.
 *
 * The flag being outside the card was the second bug. The card lifts to
 * z-index 3 under the pointer, so it painted straight over a flag that was
 * not part of it: the badge vanished from exactly the card being looked at.
 *
 * Measured in a browser after the fix, at 1440px:
 *   BEST SELLER  80x20 at the top of the column
 *   -40%         40x20, 4px below it, no overlap
 *   hovered      both still painted on top (elementFromPoint hits them)
 *   390px        43px of clear air between the right-hand pills and the
 *                stock badge on the left
 */

const root = process.cwd();
const CSS = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const CARD = fs.readFileSync(path.join(root, "src/components/ProductCard.tsx"), "utf8");
const SECTION = fs.readFileSync(path.join(root, "src/components/home/ProductSection.tsx"), "utf8");

describe("the flag belongs to the card", () => {
  it("is rendered inside it, not beside it", () => {
    /* This is what keeps it visible when the card lifts. A flag drawn as a
       sibling sits in the wrapper's stacking context and loses to
       .card:hover{z-index:3} every time. */
    const open = CARD.indexOf('className={"card"');
    const close = CARD.lastIndexOf("</Link>");
    const flags = CARD.indexOf('className="card-flags"');
    expect(open, "the card's Link").toBeGreaterThan(-1);
    expect(flags, "the flags column").toBeGreaterThan(-1);
    expect(flags).toBeGreaterThan(open);
    expect(flags).toBeLessThan(close);
  });

  it("is handed to the card as a prop, not drawn next to it", () => {
    expect(SECTION).toMatch(/flag=\{/);
    // The old sibling span, and the rule that positioned it, are both gone.
    expect(SECTION).not.toMatch(/seller-badge/);
    expect(NO_COMMENTS).not.toMatch(/\.seller-badge/);
  });

  it("lets a card carry either pill, both, or neither", () => {
    // Each is rendered on its own condition -- a best seller that is not
    // discounted still gets its flag, and vice versa.
    expect(CARD).toMatch(/\{flag && <span className="card-flag">/);
    expect(CARD).toMatch(/\{pct != null && <span className="card-deal">/);
  });
});

describe("the two pills cannot land on each other", () => {
  it("shares one positioned column instead of two pins", () => {
    const flags = /\.card-flags\{([^}]*)\}/.exec(NO_COMMENTS);
    expect(flags, "the flags column").not.toBeNull();
    expect(flags![1]).toMatch(/position:absolute/);
    expect(flags![1]).toMatch(/flex-direction:column/);
    // A gap, so the two pills are read as two things.
    expect(flags![1]).toMatch(/gap:\d+px/);
  });

  it("does not position either pill itself", () => {
    /* THE BUG. Two absolutely positioned boxes both claiming the same
       corner is what stacked them. Inside a flex column they lay
       themselves out and neither can overlap the other. */
    for (const sel of [".card-flag{", ".card-deal{"]) {
      const rule = new RegExp(sel.replace(/[.{]/g, "\\$&") + "([^}]*)\\}").exec(NO_COMMENTS);
      expect(rule, sel).not.toBeNull();
      expect(rule![1], sel).not.toMatch(/position:absolute/);
      expect(rule![1], sel).not.toMatch(/(^|;)(top|right):/);
    }
  });

  it("sits at least as high as the badges in the other corner", () => {
    // .card-tags (stock pill + heart) is z-index 2 over the same photo.
    const flags = /\.card-flags\{([^}]*)\}/.exec(NO_COMMENTS)![1];
    const tags = /\.card-tags\{([^}]*)\}/.exec(NO_COMMENTS)![1];
    const z = (s: string) => Number(/z-index:(\d+)/.exec(s)?.[1] ?? 0);
    expect(z(flags)).toBeGreaterThanOrEqual(z(tags));
  });

  it("keeps a long flag on one line", () => {
    // "MAIS VENDIDO" is half again as wide as "BEST SELLER"; wrapping it
    // would push the pill down over the photo.
    const rule = /\.card-flag,\.card-deal\{([^}]*)\}/.exec(NO_COMMENTS);
    expect(rule, "the shared pill rule").not.toBeNull();
    expect(rule![1]).toMatch(/white-space:nowrap/);
  });
});
