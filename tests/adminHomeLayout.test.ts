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

/* THE FRONT PAGE FITS ON THE SCREEN.
 *
 * It was a title, two to-do cards the height of a paragraph each, a row of
 * link buttons, a "customer loves" panel and then six statistics with two
 * charts. Everything after the first card was below the fold on a laptop.
 *
 * Measured in a browser after the rebuild, from the top of the page to the
 * bottom of the last row above the trend chart:
 *
 *   1440x900   y=610      four figures across
 *   1280x800   y=610      four across
 *   1024x768   y=610      four across
 *    820x1180  y=610      four across
 *    390x844   y=752      two across, still inside the viewport
 */

describe("the four figures", () => {
  it("are one row that reflows rather than a fixed count", () => {
    /* An account holding only two of the four sections gets two tiles, and
       they should fill the row rather than huddle at the left. */
    const row = rule(".kpi-row");
    expect(row).toMatch(/grid-template-columns:repeat\(auto-fit/);
  });

  it("fits two on a phone, not one", () => {
    /* At a 178px minimum a 390px screen fits exactly one, and the four
       figures alone become most of the screen. Measured: 968px of page at
       178, 752px at 160 -- the difference between scrolling and not. */
    const min = Number(/minmax\((\d+)px/.exec(rule(".kpi-row"))?.[1] ?? 0);
    expect(min).toBeLessThanOrEqual(164);
    // And still four across on a laptop: 4 * min + 3 gaps must clear a
    // 1024px window's content width.
    expect(min * 4).toBeLessThan(900);
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
  it("still carries the one thing no other screen computes", () => {
    /* Sales against purchases on a single timeline. Deleting it to save
       space would lose a capability rather than a decoration -- it is just
       no longer what you scroll past to find out how the shop is doing. */
    expect(HOME).toMatch(/<BusinessOverview/);
    // Below the figures and the to-do list, not above them.
    expect(HOME.indexOf('className="kpi-row"')).toBeLessThan(HOME.indexOf("<BusinessOverview"));
    expect(HOME.indexOf('className="attn-list"')).toBeLessThan(HOME.indexOf("<BusinessOverview"));
  });

  it("still withholds it from an account with neither side", () => {
    expect(HOME).toMatch(/\{\(canSales \|\| canProcurement\) && \(/);
  });

  it("keeps the hearts, and only once there are some", () => {
    /* A shop on its first day would otherwise get a confident "0 loves"
       meaning "nobody has tapped", "the migration has not been run" and
       "the feature is broken" all at once. */
    expect(HOME).toMatch(/loves && loves\.total > 0/);
  });
});
