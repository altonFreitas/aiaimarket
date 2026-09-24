import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* THE CARD THAT LIFTS UNDER THE POINTER.
 *
 * The photo leaning in said "this one" quietly, and across a row of twelve
 * it was easy to lose which card the pointer was actually on. The whole
 * card now grows, rounds off and raises a shadow.
 *
 * THE RULE IT MUST NOT BREAK: it may not touch its neighbours. A grid where
 * the hovered card overlaps the next one reads as broken rather than as
 * lively, and the amount of room it has is exactly the gap.
 *
 * Measured in a browser when this was written -- the closest approach at
 * four widths:
 *
 *     375px   card 176x344   5.0px clear
 *     768px   card 246x415   8.0px clear
 *    1440px   card 354x523   6.4px clear
 *    1920px   card 426x595   5.3px clear
 *
 * The numbers below are what those measurements depended on. Change either
 * and the sum has to be done again, which is what this test is for.
 */

const CSS = fs.readFileSync(
  path.join(process.cwd(), "src/app/globals.css"), "utf8");
const NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the growth fits inside the gap", () => {
  it("scales by a bounded amount", () => {
    const m = /\.card:hover,\.card:focus-visible\{transform:scale\(([\d.]+)\)/.exec(NO_COMMENTS);
    expect(m, "the hover scale").not.toBeNull();
    const scale = Number(m![1]);
    expect(scale).toBeGreaterThan(1);
    /* 1.035 is the ceiling the measurements above leave room for: the
       tightest case is a 176px card in a 10px gap, where 1.03 grows it by
       5.3px and leaves 5px. Past this it starts touching on a phone. */
    expect(scale).toBeLessThanOrEqual(1.035);
  });

  it("keeps the gaps the sum was done against", () => {
    // Shrinking a gap is the other way to make the card touch, and it
    // happens in a different part of the file from the scale.
    expect(NO_COMMENTS).toMatch(/\.grid\{display:grid;grid-template-columns:repeat\(2,1fr\);gap:10px\}/);
    expect(NO_COMMENTS).toMatch(/\.grid\{grid-template-columns:repeat\(3,1fr\);gap:14px\}/);
  });

  it("rises above the row while it is up", () => {
    // Or the neighbour painted after it covers the edge it just grew into.
    expect(NO_COMMENTS).toMatch(/\.card:hover,\.card:focus-visible\{[^}]*z-index:3/);
  });
});

describe("who gets it", () => {
  it("only where there is a real pointer", () => {
    /* On a touch screen "hover" is whatever was tapped last, so the lift
       would stick to a card after the finger had gone. */
    const i = NO_COMMENTS.indexOf(".card:hover,.card:focus-visible{transform:scale(");
    const guard = NO_COMMENTS.lastIndexOf("@media (hover:hover) and (pointer:fine)", i);
    expect(guard).toBeGreaterThan(-1);
    expect(i - guard).toBeLessThan(700);
  });

  it("answers the keyboard too", () => {
    // A keyboard user has the harder version of the same problem: they
    // cannot see where a pointer is at all.
    expect(NO_COMMENTS).toMatch(/\.card:hover,\.card:focus-visible\{transform:scale/);
  });

  it("still says which card, without moving, for anybody who asked", () => {
    /* prefers-reduced-motion keeps the shadow and drops the transform --
       the answer without the movement, rather than no answer. */
    const block = /@media \(prefers-reduced-motion: reduce\)\{\s*\.card:hover,\.card:focus-visible\{([^}]*)\}/
      .exec(NO_COMMENTS);
    expect(block, "the reduced-motion rule").not.toBeNull();
    expect(block![1]).toMatch(/box-shadow/);
    expect(block![1]).not.toMatch(/transform/);
  });
});

describe("the button the lift reveals", () => {
  /* REPRODUCED IN A BROWSER. Hover card one, click its heart, move to card
     two: both cards offered "Add to cart" at once, and card one went on
     offering it with the pointer off the grid entirely. Clicking a button
     focuses it, and the reveal was written as :focus-within, which a mouse
     click satisfies just as well as a keyboard.

     Measured before:  ["1","1","0"] with the pointer on card two.
     Measured after:   ["0","1","0"], and ["0","0","0"] off the grid.
  */
  it("is not revealed by a mouse click inside the card", () => {
    const reveal = /\.card:(hover|has\(:focus-visible\)|focus-within)[^{]*\{opacity:1\}/g;
    const found = NO_COMMENTS.match(reveal) ?? [];
    expect(found.length, "the reveal rules").toBeGreaterThan(0);
    for (const rule of found) {
      expect(rule, rule).not.toContain(":focus-within");
    }
  });

  it("is still revealed by the keyboard", () => {
    // A keyboard user cannot hover. Losing this would hide the button from
    // them completely, which is worse than the bug it was fixing.
    expect(NO_COMMENTS).toContain(".card:has(:focus-visible) .card-add{opacity:1}");
  });

  it("keeps the hover reveal in a rule of its own", () => {
    /* A browser that does not understand :has() discards the whole rule
       the selector appears in. Folded onto one line, an old browser would
       lose the hover reveal too -- the one that matters most. */
    expect(NO_COMMENTS).toContain(".card:hover .card-add{opacity:1}");
    expect(NO_COMMENTS).not.toMatch(/\.card:hover \.card-add,[^{]*:has\(/);
  });
});

describe("what the lift must not do", () => {
  it("draws no dark outline round the card", () => {
    /* A near-black border read as selected-and-disabled rather than as
       raised, and it fought the photograph it was framing. The card keeps
       its ordinary hairline; the lift, the corner and the shadow are the
       whole signal. */
    expect(NO_COMMENTS).not.toMatch(/\.card:hover\{border-color/);
    const hover = /\.card:hover,\.card:focus-visible\{([^}]*)\}/.exec(NO_COMMENTS);
    expect(hover, "the hover rule").not.toBeNull();
    expect(hover![1]).not.toMatch(/border-color/);
  });

  it("is not cut off by the rail it sits in", () => {
    /* THE BUG THIS FIXED. overflow-x:auto does not only clip sideways: a
       box that is not `visible` on one axis computes to `auto` on the
       other, so the homepage rails were slicing the top and bottom off any
       card that rose under the pointer -- the badge at one edge and the
       button at the other.

       Padding gives it room; the negative margin gives the space back, so
       the row occupies exactly what it did before. Measured after the fix:
       8.0px clear above and below at 390px, 8.4px at 900px, 7.5px at
       1440px. Remove either half and the card is cut again. */
    const rail = /\.rail\{([^}]*)\}/.exec(NO_COMMENTS);
    expect(rail, "the rail rule").not.toBeNull();
    const pad = /padding:(\d+)px 0/.exec(rail![1]);
    expect(pad, "vertical padding on the rail").not.toBeNull();
    expect(Number(pad![1])).toBeGreaterThanOrEqual(12);
    expect(rail![1]).toMatch(/margin:-\d+px 0/);
  });
});
