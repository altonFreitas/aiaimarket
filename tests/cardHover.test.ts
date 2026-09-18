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
    /* prefers-reduced-motion keeps the outline and the shadow and drops the
       transform -- the answer without the movement, rather than no answer. */
    const block = /@media \(prefers-reduced-motion: reduce\)\{\s*\.card:hover,\.card:focus-visible\{([^}]*)\}/
      .exec(NO_COMMENTS);
    expect(block, "the reduced-motion rule").not.toBeNull();
    expect(block![1]).toMatch(/border-color/);
    expect(block![1]).not.toMatch(/transform/);
  });
});
