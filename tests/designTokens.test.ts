import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* THE SCALES, AND THE ONE RULE THAT IS NOT A PREFERENCE.
 *
 * Most of a design system cannot be tested: whether 24px is the right
 * heading size is a judgement, and a test asserting it is just the same
 * opinion written twice. What IS testable is the handful of values that
 * stop being cosmetic the moment they drift -- and the one below is a bug
 * on a real phone, not a matter of taste.
 */

const CSS = fs.readFileSync(
  path.join(process.cwd(), "src/app/globals.css"), "utf8");

/** A declaration block by selector, comments stripped. */
function rule(selector: string): string {
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const i = stripped.indexOf(selector + "{");
  if (i === -1) return "";
  return stripped.slice(i, stripped.indexOf("}", i));
}

describe("form fields do not make mobile Safari zoom", () => {
  /* WHY THIS ONE IS A TEST AND NOT A STYLE NOTE.
   *
   * iOS Safari zooms the whole page in when a focused input has a font
   * smaller than 16px, and it does NOT zoom back out when focus leaves.
   * These boxes were 15px, so tapping the first field of the checkout
   * enlarged the page and left the shopper finishing the order scrolling
   * sideways through a form whose edges they could no longer see.
   *
   * Nobody files that as a bug -- they abandon the basket -- so nothing in
   * this repo would have noticed 16 being nudged back to 15 by somebody
   * making the form look tidier on a desktop. */
  const field = rule(".field input,.field select,.field textarea");

  it("sizes the text with the body-large token", () => {
    expect(field).toMatch(/font-size:var\(--fs-body-lg\)/);
  });

  it("and that token is at least the 16px threshold", () => {
    const m = /--fs-body-lg:(\d+(?:\.\d+)?)px/.exec(CSS);
    expect(m, "--fs-body-lg must be declared in px").not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(16);
  });

  it("gives every field a thumb-sized target", () => {
    // 44px is the WCAG target size and roughly an adult thumb. At the old
    // 9px padding these were 39px tall.
    const m = /min-height:(\d+)px/.exec(field);
    expect(m, "a min-height on the field").not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(44);
  });

  it("exempts the checkbox, which is not a text box", () => {
    // Inheriting 44px would have drawn a checkbox the size of a button.
    expect(rule(".field input[type=checkbox]")).toMatch(/min-height:0/);
  });
});

describe("an error says which field and what is wrong", () => {
  it("does not rely on colour alone", () => {
    /* The red border speaks only to somebody who sees red. The mark and
       the sentence speak to everybody, and the sentence is the only one of
       the three that says WHAT is wrong. */
    expect(rule(".field.err .msg::before")).toMatch(/content:"!"/);
    expect(rule(".field .msg")).toMatch(/color:var\(--red\)/);
  });
});

describe("the scales exist and are single-valued", () => {
  const root = CSS.slice(CSS.indexOf(":root{"), CSS.indexOf("\n}"));

  it("defines type, spacing, radius and elevation steps", () => {
    for (const tok of ["--fs-caption", "--fs-body", "--fs-h1", "--fs-display",
                       "--sp-1", "--sp-4", "--sp-8", "--sp-24",
                       "--r-s", "--r", "--r-l", "--r-xl", "--r-pill",
                       "--sh-1", "--sh-2", "--sh-3"]) {
      expect(root, `${tok} in :root`).toContain(tok + ":");
    }
  });

  it("keeps the type scale free of half pixels", () => {
    // 12.5px is not reliably between 12 and 13: it rounds per browser and
    // per zoom level, so it renders as one or the other anyway -- while
    // looking, in the source, like a decision somebody made.
    const sizes = [...root.matchAll(/--fs-[a-z0-9-]+:(\d+(?:\.\d+)?)px/g)]
      .map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(5);
    expect(sizes.filter((n) => !Number.isInteger(n))).toEqual([]);
  });

  it("keeps the spacing scale on a 4px base", () => {
    const steps = [...root.matchAll(/--sp-\d+:(\d+)px/g)].map((m) => Number(m[1]));
    expect(steps.length).toBeGreaterThan(8);
    expect(steps.filter((n) => n % 4 !== 0)).toEqual([]);
  });
});

describe("waiting is shown, not left blank", () => {
  it("the skeleton stops moving for anybody who asked it to", () => {
    /* A permanently animated page is not polish for somebody with a
       vestibular disorder. The grey blocks carry the whole message; the
       sweep was only the flourish, so the sweep is what goes. */
    const i = CSS.indexOf(".sk::after");
    const guard = CSS.lastIndexOf("prefers-reduced-motion: no-preference", i);
    expect(guard).toBeGreaterThan(-1);
    expect(i - guard).toBeLessThan(200);
  });

  it("the photo block has a shape wherever it is used", () => {
    // It was scoped to .sk-card, so the product page's standalone one had
    // no height and half that skeleton was simply absent.
    expect(rule(".sk-ph")).toMatch(/aspect-ratio:1\/1/);
  });
});
