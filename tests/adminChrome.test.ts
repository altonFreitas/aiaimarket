import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const HOME = read("src/components/admin/AdminHome.tsx");
const PAGE = read("src/app/admin/page.tsx");
const OVERVIEW = read("src/components/admin/BusinessOverview.tsx");
const OV_PAGE = read("src/app/admin/overview/page.tsx");
const LAYOUT = read("src/app/admin/layout.tsx");
const CHECKOUT = read("src/components/CheckoutForm.tsx");
const TRACK = read("src/components/TrackForm.tsx");
const I18N = read("src/lib/i18n.ts");
const CSS = read("src/app/globals.css");
const NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

describe("picking the span the figures cover", () => {
  it("offers the eight ranges the rest of the admin uses", () => {
    // From RANGES, not a second list: a picker that drifts from the one on
    // /admin/overview would send the two screens to different windows.
    expect(HOME).toMatch(/RANGES\.map/);
    expect(HOME).toMatch(/import \{ RANGES, type RangeKey \}/);
  });

  it("is links, because the figures are computed on the server", () => {
    /* A button would need the whole sales history in the browser to
       recompute anything. Links also mean a range can be bookmarked,
       opened in a second tab and sent to whoever asked. */
    const nav = /<nav className="dash-range"[\s\S]*?<\/nav>/.exec(HOME);
    expect(nav, "the picker").not.toBeNull();
    expect(nav![0]).toMatch(/<Link/);
    expect(nav![0]).not.toMatch(/<button/);
    expect(nav![0]).toMatch(/aria-current=\{range === r\.key\}/);
  });

  it("leaves the default range off the address", () => {
    // /admin and /admin?range=1m are the same page; only one of them
    // should exist as a link somebody can bookmark.
    expect(HOME).toMatch(/r\.key === "1m" \? "\/admin" : `\/admin\?range=\$\{r\.key\}`/);
  });

  it("validates what arrives in the address", () => {
    /* ?range= is whatever somebody typed. An unknown value has to land on
       a real window rather than on an empty chart, which would read as a
       shop with no trade. */
    expect(PAGE).toMatch(/function parseRange/);
    expect(PAGE).toMatch(/RANGES\.some\(\(r\) => r\.key === raw\)/);
    expect(PAGE).toMatch(/: "1m"/);
  });

  it("feeds the chosen range to every windowed calculation", () => {
    expect(PAGE).toMatch(/headlineMetrics\(lines, pos, range, today\)/);
    expect(PAGE).toMatch(/rangeWindow\(lines, pos, range, today\)/);
    expect(PAGE).toMatch(/overviewSeries\(lines, pos, range, today\)/);
  });
});

describe("closing the full overview", () => {
  it("offers a way back to the page it was opened from", () => {
    expect(OVERVIEW).toMatch(/closeHref && \(/);
    expect(OV_PAGE).toMatch(/closeHref="\/admin"/);
  });

  it("is a link, not a history step", () => {
    /* Somebody who arrived from a bookmark or by typing the address has no
       history to go back to, and a control that does nothing on one route
       in three is worse than no control. */
    const block = /\{closeHref && \([\s\S]*?\)\}/.exec(OVERVIEW)!;
    expect(block[0]).toMatch(/<Link/);
    expect(block[0]).not.toMatch(/history|router\.back/);
    expect(block[0]).toMatch(/aria-label=\{t\("close", lang\)\}/);
  });

  it("is drawn only where there is somewhere to go", () => {
    // The component is still usable somewhere with no "back".
    expect(OVERVIEW).toMatch(/closeHref\?: string;/);
  });
});

describe("the checkout says less", () => {
  it("drops the three lines nobody needed", () => {
    for (const k of ["orderSummarySub", "nameUpperHint", "noAccount"]) {
      expect(CHECKOUT, k).not.toMatch(new RegExp(`t\\("${k}"`));
    }
  });

  it("leaves the two dead keys out of the dictionary", () => {
    // An i18n key nothing renders is three translations to keep up to
    // date for nobody.
    expect(I18N).not.toMatch(/orderSummarySub:/);
    expect(I18N).not.toMatch(/nameUpperHint:/);
  });

  it("keeps the one /track still shows", () => {
    /* noAccount was on both screens and only the checkout was asked
       about. Deleting the key would have emptied a line on a page nobody
       mentioned. */
    expect(TRACK).toMatch(/t\("noAccount", lang\)/);
    expect(I18N).toMatch(/noAccount:/);
  });
});

describe("headings in the back office", () => {
  it("sets every admin h1 in capitals", () => {
    expect(NO_COMMENTS).toMatch(/\.adm h1\{[^}]*text-transform:uppercase/);
  });

  it("scopes it so the storefront is untouched", () => {
    /* An h1 out there is a product name or a shop's own name. "ADIDAS
       SAMBA" is a shout, and a shop called "Loja da Ana" does not want to
       be renamed by a stylesheet. */
    expect(NO_COMMENTS).not.toMatch(/(^|\})\s*h1\{[^}]*text-transform:uppercase/);
    expect(LAYOUT).toMatch(/className="wrap adm"/);
  });

  it("does it in CSS, not by retyping the words", () => {
    // The DOM keeps "Today", so a screen reader says it rather than
    // spelling it out, and the translations stay sentences.
    expect(I18N).toMatch(/attnTitle:\["Ohin/);
    expect(I18N).not.toMatch(/attnTitle:\[[^\]]*"TODAY"/);
  });
});
