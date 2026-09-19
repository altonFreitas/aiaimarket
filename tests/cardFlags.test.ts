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

/** The body of the standalone rule for exactly this selector.
 *
 * ".card-flag,.card-deal{...}" must not be allowed to answer for
 * ".card-deal{...}": a test asking what the discount pill does would
 * otherwise pass against a grouped rule that says nothing about it, which
 * is how the first version of these tests managed to assert "the pill does
 * not position itself" against "border-radius:4px;white-space:nowrap". */
function rule(sel: string): string {
  const re = new RegExp("(?:^|\\})\\s*" + sel.replace(/\./g, "\\.") + "\\{([^}]*)\\}");
  const m = re.exec(NO_COMMENTS);
  expect(m, `the standalone ${sel} rule`).not.toBeNull();
  return m![1];
}

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
  it("stacks them in a column with a gap", () => {
    const flags = rule(".card-flags");
    expect(flags).toMatch(/flex-direction:column/);
    expect(flags).toMatch(/gap:\d+px/);
    // Flush right whatever their widths differ by.
    expect(flags).toMatch(/align-items:flex-end/);
  });

  it("does not position either pill itself", () => {
    /* THE FIRST BUG. Two absolutely positioned boxes both claiming the
       same corner is what stacked "BEST SELLER" under "-40%". Inside a
       flex column they lay themselves out and neither can overlap. */
    for (const sel of [".card-flag", ".card-deal"]) {
      const body = rule(sel);
      expect(body, sel).not.toMatch(/position:absolute/);
      expect(body, sel).not.toMatch(/(^|;)(top|right):/);
    }
  });

  it("keeps a long flag on one line", () => {
    // "MAIS VENDIDO" is half again as wide as "BEST SELLER"; wrapping it
    // would push the pill down over the photo.
    const shared = /\.card-flag,\.card-deal\{([^}]*)\}/.exec(NO_COMMENTS);
    expect(shared, "the shared pill rule").not.toBeNull();
    expect(shared![1]).toMatch(/white-space:nowrap/);
  });
});

describe("the two corners cannot land on each other either", () => {
  /* THE SECOND BUG, and the one the first fix missed. The stock badge
     pinned itself to left:8px and the flags to right:8px, so neither
     could see the other. At 768px the homepage rail packs four cards into
     174px each and an 80px "BEST SELLER" ran 17px into "IN STOCK" -- a
     width that sat between the two the first fix was measured at.

     Swept in a browser after this fix, at 360/390/520/640/768/820/900/
     1100/1280/1440/1920: no overlap at any of them, and at the two tight
     ones (768, 820) the flags wrap to a second line 6px below the badge
     rather than on top of it. */

  it("gives the row a single positioned box spanning the photo", () => {
    const row = rule(".card-badges");
    expect(row).toMatch(/position:absolute/);
    // Both edges, or it is a corner again and cannot measure anything.
    expect(row).toMatch(/left:\d+px/);
    expect(row).toMatch(/right:\d+px/);
    expect(row).toMatch(/display:flex/);
    expect(row).toMatch(/justify-content:space-between/);
  });

  it("wraps rather than overlaps when a card is too narrow", () => {
    // The safety net. Without it the row overflows and the two halves are
    // drawn on top of each other again on the narrowest card.
    expect(rule(".card-badges")).toMatch(/flex-wrap:wrap/);
  });

  it("leaves neither half pinning itself to an edge", () => {
    for (const sel of [".card-tags", ".card-flags"]) {
      expect(rule(sel), sel).not.toMatch(/position:absolute/);
    }
  });

  it("keeps the row above the photo", () => {
    // The photo scales on hover; a row underneath it would be wiped out.
    const row = rule(".card-badges");
    expect(Number(/z-index:(\d+)/.exec(row)?.[1] ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it("renders both halves inside that one row", () => {
    const row = CARD.indexOf('className="card-badges"');
    const tags = CARD.indexOf('className="card-tags"');
    const flags = CARD.indexOf('className="card-flags"');
    expect(row).toBeGreaterThan(-1);
    expect(tags).toBeGreaterThan(row);
    expect(flags).toBeGreaterThan(row);
  });
});

describe("the discount is the loud one", () => {
  it("is red, not the same amber as the flag above it", () => {
    /* It used to be amber at 11px -- the same colour as the best-seller
       flag and smaller than the product name, so the one fact that makes
       somebody stop scrolling was the one they had to hunt for. */
    const deal = rule(".card-deal");
    expect(deal).toMatch(/background:var\(--red\)/);
    expect(deal).not.toMatch(/background:var\(--amber\)/);
  });

  it("is big enough to be the thing you see first", () => {
    const deal = rule(".card-deal");
    const size = Number(/font-size:([\d.]+)px/.exec(deal)?.[1] ?? 0);
    /* 17px measured 59x30 and still left 27px of clear air at 390px. The
       floor is what "loud" means here; the ceiling is what the card can
       hold -- past roughly 20px the two corners meet at every width
       rather than just the tight ones. */
    expect(size).toBeGreaterThanOrEqual(15);
    expect(size).toBeLessThanOrEqual(20);
    // Louder than the flag it sits with, or the hierarchy is a coin toss.
    const flagSize = Number(/font-size:([\d.]+)px/.exec(rule(".card-flag"))?.[1] ?? 0);
    expect(size).toBeGreaterThan(flagSize);
  });

  it("stays legible while it shouts", () => {
    /* White on --red is 5.60:1, past the 4.5:1 this needs. A louder red
       with white on it is the easy way to break that. */
    const deal = rule(".card-deal");
    expect(deal).toMatch(/color:#fff\b/);
    expect(NO_COMMENTS).toMatch(/--red:#bb3a2a/);
  });
});
