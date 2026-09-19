import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const CSS = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const HEADER = fs.readFileSync(path.join(root, "src/components/Header.tsx"), "utf8");

/** The body of the standalone rule for exactly this selector -- not a
 *  grouped rule that merely contains it. */
function rule(sel: string): string {
  const re = new RegExp("(?:^|\\})\\s*" + sel.replace(/\./g, "\\.") + "\\{([^}]*)\\}");
  const m = re.exec(NO_COMMENTS);
  expect(m, `the standalone ${sel} rule`).not.toBeNull();
  return m![1];
}
const px = (body: string, prop: string) =>
  Number(new RegExp(prop + ":(-?[\\d.]+)px").exec(body)?.[1] ?? NaN);

describe("the homepage row headings", () => {
  it("is a third bigger than it was", () => {
    /* At 19px "New Arrivals" was barely louder than the product names
       under it, so six rows of cards read as one undifferentiated column.
       25px is the 30% asked for. */
    const size = px(rule(".home-section-hd h2"), "font-size");
    expect(size).toBeGreaterThanOrEqual(24);
    expect(size).toBeLessThanOrEqual(26);
  });

  it("gives the extra height back so the cards do not move", () => {
    /* THE CONDITION ATTACHED TO THE ASK. The taller line box grows the
       heading block by 3px, so the gap under it gives 3px back: 12 -> 9.
       Measured against the previous stylesheet on the same page, the
       first card moved -1/0/-1px at 390/768/1440.

       Both bounds matter. Too much and the cards move down; too little
       and they move UP, which is the same broken promise -- 6px was tried
       and pulled them up by 4. */
    const gap = px(rule(".home-section-hd"), "margin-bottom");
    expect(gap).toBeGreaterThanOrEqual(7);
    expect(gap).toBeLessThanOrEqual(11);
  });
});

describe("buttons that look like buttons", () => {
  it("fills the secondary one instead of outlining it", () => {
    /* "Add to cart" and "Share" were transparent with a hairline round
       them, which reads as disabled -- and against the paper the page is
       made of, as nothing at all. */
    const ghost = rule(".btn-ghost");
    expect(ghost).not.toMatch(/background:transparent/);
    expect(ghost).toMatch(/background:var\(--surface-2\)/);
  });

  it("still answers the pointer once it has a fill", () => {
    /* The old hover WAS the fill, so filling it at rest without moving
       the hover would have left a button that does not respond. Both the
       surface and the edge change, so the answer survives on a white
       panel and on the paper alike. */
    const hover = rule(".btn-ghost:hover");
    expect(hover).toMatch(/background:var\(--surface-2-hi\)/);
    expect(hover).toMatch(/border-color/);
    expect(rule(".btn-ghost")).not.toMatch(/background:var\(--surface-2-hi\)/);
  });

  it("fills the destructive one too, and commits on hover", () => {
    const danger = rule(".btn-danger");
    expect(danger).not.toMatch(/background:transparent/);
    expect(danger).toMatch(/background:var\(--red-soft\)/);
    // Solid red with white on it: darkening the tint any further would
    // have taken the red text on it below 4.5:1.
    const hover = rule(".btn-danger:hover");
    expect(hover).toMatch(/background:var\(--red\)/);
    expect(hover).toMatch(/color:#fff/);
  });

  it("gives the hero's second button its own body", () => {
    /* It stands on a dark panel and overrides colour but never
       background, so the light fill above would have put white text on
       pale grey. */
    const heroGhost = /\.home \.hero-cta \.btn-ghost\{([^}]*)\}/.exec(NO_COMMENTS);
    expect(heroGhost, "the hero ghost override").not.toBeNull();
    expect(heroGhost![1]).toMatch(/background:rgba\(255,255,255/);
    expect(heroGhost![1]).toMatch(/color:#fff/);
  });
});

describe("the cloth behind the page", () => {
  it("is fainter than it was, and still there", () => {
    const o = Number(/--tais-opacity:([\d.]+)/.exec(NO_COMMENTS)?.[1] ?? NaN);
    // Its own note: below ~.06 it is invisible on most screens, past ~.16
    // it competes with the product photography.
    expect(o).toBeGreaterThanOrEqual(0.06);
    expect(o).toBeLessThan(0.12);
  });
});

describe("the way to order tracking", () => {
  it("is not wearing the search icon any more", () => {
    /* The magnifying glass is the SEARCH icon and sits three elements to
       the left in the same bar, so "where is my order" was dressed as
       "find a product". */
    const link = /<Link className="icon-btn hd-track"[\s\S]*?<\/Link>/.exec(HEADER);
    expect(link, "the track link").not.toBeNull();
    const svg = link![0].replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(svg).not.toMatch(/<circle cx="11" cy="11" r="7"/);
    // A parcel: the box outline plus the two strokes of its open top.
    expect(svg.match(/<path/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(svg).toMatch(/aria-hidden="true"/);
  });

  it("still says what it is in words", () => {
    // An unlabelled glyph in a header is a guessing game, and this is the
    // only route to tracking on a desktop.
    const link = /<Link className="icon-btn hd-track"[\s\S]*?<\/Link>/.exec(HEADER)![0];
    expect(link).toMatch(/\{t\("navTrack", lang\)\}/);
  });
});
