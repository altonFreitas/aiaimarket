import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* THE CONTRAST AUDIT NOBODY HAD DONE.
 *
 * The palette was chosen by eye, and by eye --muted-2 on the page ground
 * came to 2.80:1 -- well under the 4.5:1 that WCAG AA asks of body text,
 * and it carries the small print on every screen in the app: the seller
 * line under a product, timestamps, chart labels, the "(12)" beside a
 * rating. Small text, so the 3:1 large-text exemption never applied.
 *
 * This reads the real tokens out of globals.css rather than restating
 * them, because a test with its own copy of the palette passes forever
 * while the stylesheet drifts away from it.
 */

const CSS = readFileSync(resolve(__dirname, "../src/app/globals.css"), "utf8");

/** Every `--name:#hex` in the :root block. */
function tokens(): Record<string, string> {
  const root = CSS.slice(CSS.indexOf(":root{"), CSS.indexOf("*{box-sizing"));
  const out: Record<string, string> = {};
  for (const m of root.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 relative contrast, 1:1 to 21:1. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The floor for text below 18px (or below 14px bold), which is nearly all
 * of the text these tokens are used for. */
const AA = 4.5;

const T = tokens();

/** Every ground a page actually paints behind text: the card, the page,
 * and --line-2, which is a hovered sidebar row and the placeholder behind
 * a product photo while it loads. */
const GROUNDS = ["card", "paper", "line-2"] as const;

describe("the token palette", () => {
  it("was read out of globals.css", () => {
    // If the :root block is ever restructured, this test must fail loudly
    // rather than quietly checking an empty set and passing.
    expect(Object.keys(T).length).toBeGreaterThan(10);
    for (const name of ["ink", "muted", "muted-2", "amber", "green", "red", "wa"]) {
      expect([name, T[name]]).toEqual([name, expect.stringMatching(/^#[0-9a-f]{3,6}$/i)]);
    }
  });

  it("puts every text colour at 4.5:1 or better on every ground it is used on", () => {
    const failures: string[] = [];
    for (const fg of ["ink", "ink-2", "ink-3", "muted", "muted-2", "green", "red", "amber-ink"]) {
      for (const bg of GROUNDS) {
        const ratio = contrast(T[fg], T[bg]);
        if (ratio < AA) failures.push(`--${fg} on --${bg} is ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("holds the coloured notices to the same bar", () => {
    // .note.bad, .note.ok, the stock pills: coloured text on its own soft
    // tint, which is the tightest pairing in the palette.
    const failures: string[] = [];
    for (const [fg, bg] of [
      ["red", "red-soft"], ["green", "green-soft"],
      ["amber-ink", "amber"], ["amber-ink", "amber-soft"],
    ]) {
      const ratio = contrast(T[fg], T[bg]);
      if (ratio < AA) failures.push(`--${fg} on --${bg} is ${ratio.toFixed(2)}:1`);
    }
    expect(failures).toEqual([]);
  });

  it("keeps white legible on the two filled buttons", () => {
    // --wa is the WhatsApp order button, which is how most orders start,
    // and its label is white. It measured 3.09:1.
    for (const token of ["wa", "wa-dark"]) {
      const ratio = contrast("#ffffff", T[token]);
      expect([token, ratio >= AA]).toEqual([token, true]);
    }
  });

  it("keeps the amber buttons' own ink legible", () => {
    // .btn-amber and the cart count hardcode this one rather than using a
    // token, so it has to be named here or nothing checks it.
    expect(contrast("#3a2b00", T["amber"])).toBeGreaterThanOrEqual(AA);
  });

  it("still has four distinguishable levels of grey, darkest first", () => {
    // Making everything pass by turning it all black would satisfy the
    // rule and destroy the hierarchy the small print depends on.
    const ramp = ["ink", "ink-3", "muted", "muted-2"]
      .map((k) => contrast(T[k], T["paper"]));
    for (let i = 1; i < ramp.length; i++) {
      expect([i, ramp[i] < ramp[i - 1]]).toEqual([i, true]);
      // Visibly apart, not a rounding error apart.
      expect([i, ramp[i - 1] - ramp[i] > 1]).toEqual([i, true]);
    }
  });
});

/* EVERY TOKEN A RULE ASKS FOR MUST EXIST.
 *
 * A `var(--r-m)` that was never defined is not an error anywhere: the
 * browser drops the whole declaration and the element quietly renders
 * with square corners, or inherited text, or a transparent background.
 * Nothing goes red, so it survives review and ships.
 *
 * Four were found this way, three of them written during this redesign:
 * --r-m and --fs-base (never existed), --r-sm (a typo for --r-s) and
 * --danger and --bg (names from some other palette). A fallback --
 * var(--ok, var(--green, #1f8a4c)) -- is deliberate and allowed.
 */
describe("the stylesheet's variable references", () => {
  /** Injected at runtime by next/font (see app/layout.tsx), so they are
   * never declared in the stylesheet and never can be. */
  const RUNTIME = ["--font-inter", "--font-grotesk", "--font-jakarta"];

  it("names no token that is never defined and has no fallback", () => {
    const defined = new Set(Array.from(CSS.matchAll(/(--[a-z0-9-]+)\s*:/g), (m) => m[1]));
    const missing: string[] = [];
    for (const m of CSS.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,?)/g)) {
      const [, name, fallback] = m;
      if (fallback || defined.has(name) || RUNTIME.includes(name)) continue;
      missing.push(`${name} (line ${CSS.slice(0, m.index).split("\n").length})`);
    }
    expect(missing).toEqual([]);
  });

  it("is reading a stylesheet with tokens in it at all", () => {
    // Guards the guard: a regex that stopped matching would report an
    // empty list of failures for ever.
    expect(Array.from(CSS.matchAll(/var\(\s*--[a-z0-9-]+/g)).length).toBeGreaterThan(200);
  });
});
