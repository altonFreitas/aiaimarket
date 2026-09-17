import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* THE ADMIN AND SELLER SCREENS.
 *
 * These are the screens somebody runs the shop from, several hours a day,
 * often on a phone while standing in it. They are also the screens nobody
 * redesigns, because customers never see them -- so the rules below are
 * the ones most likely to be quietly undone later.
 */

const ROOT = process.cwd();
const CSS = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
const NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const i = NO_COMMENTS.indexOf(selector + "{");
  if (i === -1) return "";
  return NO_COMMENTS.slice(i, NO_COMMENTS.indexOf("}", i));
}

/** Every .tsx under src, as [path, source]. */
function sources(): [string, string][] {
  const out: [string, string][] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx")) out.push([p, fs.readFileSync(p, "utf8")]);
    }
  };
  walk(path.join(ROOT, "src"));
  return out;
}

describe("a table that scrolls says so, and can be scrolled without a mouse", () => {
  /* MEASURED: on a 390px phone, 281px of the admin-users table sat outside
     its box with nothing indicating it. The last column shown was
     "Access", so two-factor state, last login, status and the Edit button
     were not clipped-and-inviting-a-swipe -- they were absent. Somebody
     checking whether a staff account still had 2FA on would have concluded
     the column did not exist. */
  const sx = rule(".scroll-x");

  it("paints a shadow at the edge there is more content behind", () => {
    expect(sx).toMatch(/background-attachment:local, local, scroll, scroll/);
    expect(sx).toMatch(/background-image:[\s\S]*linear-gradient/);
  });

  it("does not let the cover layer hide the shadow permanently", () => {
    /* THE BUG THIS PASS ACTUALLY MADE. The first attempt gave the cover
       layer `background-size:100% 100%`, so it painted the card colour
       across the whole box and the shadow underneath never showed: the
       affordance existed in the stylesheet and nowhere on screen, which is
       worse than not having written it, because it reads as done.

       The covers must be narrow strips at the two edges. */
    const size = /background-size:([^;]*)/.exec(sx)?.[1] ?? "";
    expect(size, "a background-size on .scroll-x").not.toBe("");
    expect(size).not.toMatch(/100%\s+100%/);
    const widths = [...size.matchAll(/(\d+)px/g)].map((m) => Number(m[1]));
    expect(widths.length).toBe(4);
    expect(Math.max(...widths)).toBeLessThan(80);
  });

  it("is reachable from a keyboard", () => {
    /* A div that scrolls but contains nothing focusable cannot be scrolled
       by keyboard at all, so everything behind that fade was unreachable
       for anybody not using a mouse. tabindex=0 makes the box itself
       focusable and the arrow keys work. */
    expect(sx).toBeTruthy();
    expect(rule(".scroll-x:focus-visible")).toMatch(/outline/);
    const bad = sources()
      .filter(([, src]) => src.includes('className="scroll-x"'))
      .filter(([, src]) =>
        /className="scroll-x"(?![^>]*tabIndex)/.test(src))
      .map(([p]) => path.relative(ROOT, p));
    expect(bad, "scroll-x without tabIndex").toEqual([]);
  });
});

describe("the admin navigation is a real tap target", () => {
  it("gives its links 44px", () => {
    // Primary navigation, used one-handed on a phone. 35px before.
    const m = /min-height:(\d+)px/.exec(rule(".adm-nav a"));
    expect(m, "min-height on .adm-nav a").not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(44);
  });

  it("and the sign-out icon beside them", () => {
    expect(rule(".adm-nav-icon")).toMatch(/width:44px;height:44px/);
  });

  /* Deliberately NOT asserted: 44px on .btn-sm. Those are 47x32, which
     clears WCAG 2.5.8 (24px), and giving each 44 would add most of a row's
     height to every line of every table -- fewer orders per screen on the
     screens whose whole job is showing many rows. A trade, made on
     purpose. */
});

describe("these screens show that they are loading", () => {
  it("covers every admin and seller route from the segment root", () => {
    // One loading.tsx per segment covers all its children, so /admin/orders
    // and /admin/finance are included without a file each.
    for (const f of ["src/app/admin/loading.tsx", "src/app/seller/loading.tsx"]) {
      expect(fs.existsSync(path.join(ROOT, f)), f).toBe(true);
    }
  });
});

describe("the admin and seller stylesheet is on the scale", () => {
  const SECTION_NAMES = [
    "admin", "stock control table", "the order book (/admin/orders)",
    "the two-level access checklist", "finance: the chart of accounts",
    "demand funnel", "procurement dashboard", "Home: the business overview",
  ];

  /** Section bodies for the admin/seller surfaces, comments stripped. */
  function adminSections(): [string, string][] {
    const parts = CSS.split(/\/\* -{10} (.*?) -{10} \*\//);
    const out: [string, string][] = [];
    for (let i = 1; i < parts.length; i += 2) {
      if (SECTION_NAMES.some((n) => parts[i].includes(n))) {
        out.push([parts[i], parts[i + 1].replace(/\/\*[\s\S]*?\*\//g, "")]);
      }
    }
    return out;
  }

  it("found the sections it means to check", () => {
    // A rename upstream would otherwise turn this whole block into a
    // test that checks nothing and passes.
    expect(adminSections().length).toBeGreaterThanOrEqual(6);
  });

  it("sizes text with tokens, not loose pixels", () => {
    /* These sections held 19 distinct font sizes including 9.5, 10.5, 11.5,
       12.5 and 13.5. Half-pixel sizes do not render as half pixels -- they
       round per browser and per zoom -- so they were never the in-between
       value they looked like in the source.

       The exceptions are named: SVG chart ticks and the counter bump on
       the bottom nav are not prose, and enlarging them reflows a chart. */
    const EXEMPT = /\.(lc-tick|chart-bar-val|sort-caret|bump)\b/;
    const offenders: string[] = [];
    for (const [name, body] of adminSections()) {
      for (const block of body.split("}")) {
        if (EXEMPT.test(block)) continue;
        const m = /font-size:(\d+(?:\.\d+)?)px/.exec(block);
        if (m) offenders.push(`${name}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
