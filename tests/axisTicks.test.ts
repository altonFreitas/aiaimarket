import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { axisTicks } from "@/lib/axisTicks";

const ROOT = path.join(__dirname, "..");
const CSS = fs.readFileSync(path.join(ROOT, "src", "app", "globals.css"), "utf8");
const CHARTS = fs.readFileSync(
  path.join(ROOT, "src", "components", "admin", "Charts.tsx"), "utf8");

/** The rule body for one selector, as written in globals.css. */
function rule(selector: string): string {
  const i = CSS.indexOf("\n" + selector + "{");
  if (i < 0) throw new Error(`no standalone rule for ${selector}`);
  const open = CSS.indexOf("{", i);
  return CSS.slice(open + 1, CSS.indexOf("}", open));
}

describe("axisTicks", () => {
  it("labels every bucket while the columns are wider than a date", () => {
    // Six months of monthly bars: there was never a crowding problem here
    // and thinning them would be a loss for nothing. Eight is the last
    // count at which a column still holds a date on a phone.
    expect([...axisTicks(6)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(axisTicks(8).size).toBe(8);
    expect([...axisTicks(8)].sort((a, b) => a - b)).toEqual([0,1,2,3,4,5,6,7]);
  });

  it("thins the twenty-four-bucket axis that wrapped", () => {
    // The reported bug: 24 daily buckets on the front page, every one
    // labelled, in a tile about 600px wide.
    const ticks = axisTicks(24);
    expect(ticks.size).toBe(6);
    expect([...ticks].sort((a, b) => a - b)).toEqual([3, 7, 11, 15, 19, 23]);
  });

  it("leaves at least two columns between labels once it is thinning", () => {
    // The whole point. Adjacent indices would draw two dates in one
    // column's width. Measured in the browser: at 24 buckets on a phone
    // this is a step of 4, which leaves about 12px between them even
    // after the last label is pulled inward.
    for (let n = 9; n <= 60; n++) {
      const sorted = [...axisTicks(n)].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("always labels the last bucket", () => {
    // "How did we do this month" is read off the right-hand end, so the
    // final column is the one that must never be blank.
    for (let n = 1; n <= 60; n++) expect(axisTicks(n).has(n - 1)).toBe(true);
  });

  it("never exceeds the tick budget", () => {
    // Eight while every column still fits a date, six once thinning
    // starts -- never more than either.
    for (let n = 1; n <= 200; n++) {
      const size = axisTicks(n).size;
      expect(size).toBeLessThanOrEqual(n <= 8 ? 8 : 6);
    }
  });

  it("honours a caller's own budget", () => {
    expect(axisTicks(24, 4).size).toBeLessThanOrEqual(4);
    expect(axisTicks(24, 4).has(23)).toBe(true);
  });

  it("returns nothing for an empty or nonsense series", () => {
    // DualBars renders Empty before it ever gets here, but a helper that
    // throws on 0 would make that ordering load-bearing.
    expect(axisTicks(0).size).toBe(0);
    expect(axisTicks(-3).size).toBe(0);
    expect(axisTicks(NaN).size).toBe(0);
  });

  it("only produces indices that exist in the series", () => {
    for (let n = 1; n <= 60; n++) {
      for (const i of axisTicks(n)) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(n);
      }
    }
  });
});

describe("the dual-bar axis", () => {
  it("asks axisTicks which columns to label", () => {
    expect(CHARTS).toContain('from "@/lib/axisTicks"');
    expect(CHARTS).toContain("const ticks = axisTicks(points.length)");
  });

  it("renders a label only on a tick column", () => {
    // Guards the actual defect: without the condition every column gets a
    // date back and the axis wraps again.
    expect(CHARTS).toContain('{ticks.has(i) && <span className="dchart-lbl">{p.label}</span>}');
  });

  it("keeps a hover title on every column, labelled or not", () => {
    // Thinning is only acceptable because an unlabelled bar can still be
    // asked what it is. If the title moved behind the same condition,
    // eight of every nine bars would become unidentifiable.
    const col = CHARTS.slice(CHARTS.indexOf('<div className="dchart-col"'));
    const title = col.indexOf("title={p.title");
    const cond = col.indexOf("ticks.has(i)");
    expect(title).toBeGreaterThan(-1);
    expect(title).toBeLessThan(cond);
  });

  it("forbids the label wrapping onto a second line", () => {
    // "29/08" breaking into "29/" over "08" is the thing the user saw.
    expect(rule(".dchart-lbl")).toContain("white-space:nowrap");
  });

  it("lets a label overflow its own column instead of being boxed in", () => {
    const r = rule(".dchart-lbl");
    expect(r).toContain("left:50%");
    expect(r).toContain("translateX(-50%)");
    // right:0 with left:0 is what constrained it to one column's width.
    expect(r).not.toMatch(/(^|;)right:0/);
  });

  it("pulls the end labels inward so the clipping box cannot cut them", () => {
    /* MEASURED, NOT GUESSED. The panel body carries overflow:auto from the
       height cap on .dash-card children, so a centred label on the FINAL
       column had its overhang sliced off and the axis ended "21/0".
       Centring is right everywhere the neighbouring columns are blank; at
       the two ends there is nothing to overhang into. */
    expect(rule(".dchart-col:first-child .dchart-lbl")).toContain("left:0");
    const last = rule(".dchart-col:last-child .dchart-lbl");
    expect(last).toContain("right:0");
    expect(last).toContain("left:auto");
    // Without dropping the centring transform the label is shifted back
    // out by half its width and clipped again.
    expect(last).toContain("transform:none");
  });
});
