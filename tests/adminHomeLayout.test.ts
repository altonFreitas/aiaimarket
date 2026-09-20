import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const HOME = fs.readFileSync(path.join(root, "src/components/admin/AdminHome.tsx"), "utf8");
const CSS = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

function rule(sel: string): string {
  const re = new RegExp("(?:^|\\})\\s*" + sel.replace(/\./g, "\\.") + "\\{([^}]*)\\}");
  const m = re.exec(NO_COMMENTS);
  expect(m, `the standalone ${sel} rule`).not.toBeNull();
  return m![1];
}

/* THE FRONT PAGE IS A DASHBOARD THAT FITS ON THE SCREEN.
 *
 * Measured in a browser against the real admin chrome (the site header
 * plus AdminNav, 124px), page total against the viewport:
 *
 *   1920x1080  124 + 504 = 628   fits
 *   1600x900   124 + 504 = 628   fits
 *   1440x900   124 + 504 = 628   fits
 *   1366x768   124 + 504 = 628   fits
 *   1280x800   124 + 504 = 628   fits
 *   1024x768   124 + 527 = 651   fits
 *
 * HOW IT DOES NOT WORK. The first attempt gave the page
 * height:calc(100dvh - the pinned chrome) so the panels would share what
 * was left. That has to guess how tall the chrome is, the guess was wrong,
 * and the result was three cards stretched to 593px around 270px of
 * content on a page that scrolled anyway. What works is capping what can
 * grow: the panels' bodies stop at a share of the viewport and scroll
 * inside themselves.
 */

describe("the figures", () => {
  it("are one row that reflows rather than a fixed count", () => {
    /* An account holding only two of the four sections gets two tiles, and
       they should fill the row rather than huddle at the left. */
    const row = rule(".kpi-row");
    expect(row).toMatch(/grid-template-columns:repeat\(auto-fit/);
  });

  it("fits two on a phone and all six on a laptop", () => {
    const min = Number(/minmax\((\d+)px/.exec(rule(".kpi-row"))?.[1] ?? 0);
    // Two across a 390px phone: 2 * min + a gap must clear ~358px of
    // content width.
    expect(min * 2).toBeLessThan(350);
    // Six across a 1024px window.
    expect(min * 6).toBeLessThan(980);
  });

  it("says what period each figure covers, on the tile", () => {
    /* The row once put a 30-day revenue beside an all-time profit with
       nothing to say so. The basis is rendered, not just computed. */
    expect(HOME).toMatch(/className="kpi-basis"/);
    expect(HOME).toMatch(/\{t\(k\.basisKey, lang\)\}/);
    expect(rule(".kpi-basis")).toMatch(/color:/);
  });

  it("gives each area its own accent", () => {
    /* Six identical white cards make the eye read left to right and start
       again. The accent belongs to the AREA, not to whether the number is
       good -- that is what the note colour is for. */
    for (const k of ["sales", "profit", "orders", "catalog", "spend", "finance"]) {
      expect(rule(`.kpi-a-${k}`), k).toMatch(/border-top-color:/);
    }
  });

  it("puts the label above the figure", () => {
    // A dashboard that leads with the number makes you read every number
    // to find the one you wanted; the label is what you scan by.
    expect(HOME.indexOf('className="kpi-label"'))
      .toBeLessThan(HOME.indexOf('className="kpi-value"'));
  });

  it("colours only what has a direction", () => {
    expect(rule(".kpi-good")).toMatch(/var\(--green\)/);
    expect(rule(".kpi-bad")).toMatch(/var\(--red\)/);
    expect(rule(".kpi-flat")).toMatch(/var\(--muted\)/);
  });
});

describe("the to-do list", () => {
  it("is rows, not cards", () => {
    // Each card was the height of a paragraph, which is what pushed
    // everything else below the fold.
    expect(HOME).toMatch(/className="attn-list"/);
    expect(HOME).toMatch(/className={"attn-row "/);
    expect(HOME).not.toMatch(/className="attn-grid"/);
  });

  it("still ranks urgent differently from the rest", () => {
    /* A list where everything looks equally important ranks nothing.
       THE BUG THIS CAUGHT: .attn-row sets `border-left:3px solid
       transparent`, and being later in the file at equal specificity it
       overrode the severity colours set for the cards these replaced --
       every row drew a 3px stripe in no colour at all. */
    expect(rule(".attn-row.attn-urgent")).toMatch(/border-left-color:var\(--red\)/);
    expect(rule(".attn-row.attn-warn")).toMatch(/border-left-color:var\(--amber\)/);
    const base = rule(".attn-row");
    expect(base).toMatch(/border-left:3px solid transparent/);
    // The restatement has to come after the shorthand, or it loses again.
    expect(NO_COMMENTS.indexOf(".attn-row{"))
      .toBeLessThan(NO_COMMENTS.indexOf(".attn-row.attn-urgent{"));
  });

  it("lines the counts up in their own column", () => {
    // A grid, not a flex row: 3 and 147 must not push their labels out of
    // step with each other.
    expect(rule(".attn-row")).toMatch(/display:grid/);
  });
});

describe("what the page keeps", () => {
  it("moved the deep overview rather than deleting it", () => {
    /* Sales against purchases on a single timeline is the one thing this
       page computed that no other screen could, so it was never a
       candidate for deletion to save space -- it had outgrown being the
       bottom half of a front page. The front page keeps a monthly summary
       and links to the full thing. */
    const OVERVIEW = fs.readFileSync(
      path.join(root, "src/app/admin/overview/page.tsx"), "utf8");
    expect(OVERVIEW).toMatch(/<BusinessOverview/);
    expect(OVERVIEW).toMatch(/requireSection\("home\.overview"\)/);
    expect(HOME).toMatch(/href="\/admin\/overview"/);
    expect(HOME).toMatch(/<DualBars/);
  });

  it("still withholds the two sides from an account without them", () => {
    expect(HOME).toMatch(/\{\(canSales \|\| canProcurement\) && \(/);
    expect(HOME).toMatch(/\{canSales && \(/);
  });

  it("caps what can grow instead of forcing a page height", () => {
    const body = /\.dash-card > :not\(\.dash-card-hd\)\{([^}]*)\}/.exec(NO_COMMENTS);
    expect(body, "the panel body rule").not.toBeNull();
    expect(body![1]).toMatch(/max-height:clamp\(/);
    expect(body![1]).toMatch(/overflow:auto/);
    // And the page itself is not pinned to a guessed viewport arithmetic.
    expect(rule(".dash")).not.toMatch(/height:calc\(100dvh/);
  });

  it("keeps the hearts, and only once there are some", () => {
    /* A shop on its first day would otherwise get a confident "0 loves"
       meaning "nobody has tapped", "the migration has not been run" and
       "the feature is broken" all at once. */
    expect(HOME).toMatch(/loves && loves\.total > 0/);
  });
});
