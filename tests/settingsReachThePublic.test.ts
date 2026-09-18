import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseNum, normalizeNumText } from "@/lib/numberInput";

/* THE SETTINGS THAT WERE SAVED AND NEVER READ.
 *
 * Reported from a live shop: the trading address and registration number
 * were filled in and the Terms page still printed "{REGISTRATION — FILL
 * IN}"; the currency was set to EUR and every price stayed in dollars; the
 * tax was set to 10% and checkout said nothing about tax.
 *
 * One cause under all three. legal-currency-tax.sql added nine columns;
 * neither the anon column GRANT nor the storefront's SELECT was extended to
 * include them, so the database refused them and the app never asked. Every
 * reader then did the right thing with the nothing it was given.
 */

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const PUBLIC = code("src/lib/data/public.ts");
const GRANT = read("supabase/legal-currency-tax.sql");

describe("the storefront asks for the facts it prints", () => {
  const NINE = [
    "legal_address", "legal_registration", "legal_retention_years",
    "legal_return_days", "legal_refund_days",
    "display_currency", "tax_rate", "tax_label", "tax_included",
  ];

  it("selects all nine", () => {
    /* Read out of the SELECT LIST, not out of the file. An earlier version
       of this test searched the whole source, which kept passing when the
       query was changed back to the core columns -- the names were still
       there, in the unused constant right above it. That is the same
       vacuous-test trap this repo has hit twice before. */
    const extras = /const SETTINGS_PUBLIC_EXTRAS =\s*([\s\S]*?);/.exec(PUBLIC)?.[1] ?? "";
    for (const col of NINE) {
      expect(extras, `${col} in SETTINGS_PUBLIC_EXTRAS`).toContain(col);
    }
    // ...and that the query actually asks for them.
    expect(PUBLIC).toMatch(/\.select\(SETTINGS_CORE \+ SETTINGS_PUBLIC_EXTRAS\)/);
  });

  it("still keeps its select explicit", () => {
    /* select("*") would ask for totp_secret, which anon is refused, and the
       whole query would fail -- the storefront would report "not
       connected". The fix for a missing column is never a wider select. */
    expect(PUBLIC).not.toMatch(/from\("settings"\)[\s\S]{0,80}select\("\*"\)/);
  });

  it("falls back rather than going blank on a database without them", () => {
    /* Asking for a column that does not exist fails the WHOLE select, so a
       shop that has not run the migration would lose its name, its zones
       and its bank details too -- a worse bug than the one being fixed. */
    expect(PUBLIC).toContain("SETTINGS_CORE");
    expect(PUBLIC).toMatch(/select\(SETTINGS_CORE\)/);
  });
});

describe("the database hands them over, and nothing else", () => {
  it("grants the nine to anon", () => {
    for (const col of ["legal_address", "display_currency", "tax_rate", "tax_label"]) {
      expect(GRANT, col).toContain(col);
    }
    expect(GRANT).toMatch(/grant select[\s\S]*to anon, authenticated/);
  });

  it("does not grant what is nobody's business", () => {
    /* commission_rate is between the shop and its sellers; totp_secret is a
       credential. Both are read with the service role, which bypasses these
       grants -- widening this file to include them would publish them to
       the anon key, which lives in the browser. */
    expect(GRANT).not.toMatch(/grant select[^;]*commission_rate/);
    expect(GRANT).not.toMatch(/grant select[^;]*totp_secret/);
  });

  it("takes the per-category rate back out", () => {
    /* It was built and then removed at the shop's request: it asked every
       category to answer a question this shop does not have. Dropped rather
       than left standing, so the column cannot sit half-populated with
       figures nothing reads -- which is how a number ends up on an invoice
       two years later with no code behind it. */
    expect(GRANT).toMatch(/alter table categories drop column if exists tax_rate/);
    expect(GRANT).toMatch(/drop constraint if exists categories_tax_rate_check/);
  });
});

describe("prices print in the currency the shop chose", () => {
  const STOREFRONT = [
    "src/components/ProductCard.tsx", "src/components/BasketView.tsx",
    "src/components/ProductInteractive.tsx", "src/components/MegaNav.tsx",
    "src/components/Sidebar.tsx", "src/components/MobileNav.tsx",
  ];

  it("goes through the hook, not the bare formatter", () => {
    /* Every one of these called money(n) with no currency, so formatMoney
       fell back to its USD default and the setting changed nothing. The
       hook cannot forget the argument. */
    for (const f of STOREFRONT) {
      const src = code(f);
      expect(src, `${f} uses useMoney()`).toContain("useMoney()");
      expect(src, `${f} has no bare money( call left`).not.toMatch(/[^a-zA-Z]money\(/);
    }
  });

  it("is provided once, from the shop's settings", () => {
    const layout = code("src/app/layout.tsx");
    expect(layout).toContain("<CurrencyProvider");
    expect(layout).toMatch(/code=\{settings\.display_currency\}/);
  });

  it("shows an old order in the currency it was placed in", () => {
    /* A shop that switches from dollars to euros has not re-priced what it
       already sold, and relabelling a past receipt misstates what the
       customer paid. The code is frozen on the order for this reason. */
    const track = code("src/components/TrackForm.tsx");
    expect(track).toMatch(/money\(o\.total, o\.currency/);
    expect(track).toMatch(/money\(o\.subtotal, o\.currency/);
  });
});

describe("a number box accepts what the person's keyboard produces", () => {
  it("reads a decimal comma", () => {
    /* A number input steps and formats in the BROWSER's locale, and in
       Portuguese the decimal separator is a comma -- so the spinner on the
       Tax box produced "0,01", which Number() reads as NaN. Without this a
       shop typing "2,5" would have saved 0 and charged no tax at all, while
       the box showed 2,5. */
    expect(parseNum("0,01", 0)).toBe(0.01);
    expect(parseNum("2,5", 0)).toBe(2.5);
    expect(parseNum("2.5", 0)).toBe(2.5);
  });

  it("refuses an ambiguous thousands separator rather than guessing", () => {
    // "1,234" is 1234 in English and 1.234 in Portuguese. On a tax rate,
    // guessing wrong is a factor of a thousand.
    expect(parseNum("1,234.5", 7)).toBe(7);
    expect(parseNum("1,2,3", 7)).toBe(7);
  });

  it("treats an empty box as the fallback, not as zero-by-accident", () => {
    expect(parseNum("", 10)).toBe(10);
    expect(parseNum("   ", 10)).toBe(10);
    expect(parseNum("-", 10)).toBe(10);
  });

  it("settles the text into the form it will be saved in", () => {
    expect(normalizeNumText("0,01", 0)).toBe("0.01");
    expect(normalizeNumText("2,5", 0)).toBe("2.5");
    // An empty box stays empty: rewriting it to "0" the moment it is
    // touched is the bug this whole file is about.
    expect(normalizeNumText("", 0)).toBe("");
  });
});

describe("the quantity picker will not ask for more than the shelf holds", () => {
  const PI = code("src/components/ProductInteractive.tsx");

  it("caps at what is available in the chosen size", () => {
    expect(PI).toMatch(/const sizeLeft = tracked && size \? availableInSize/);
    expect(PI).toMatch(/setQty\(\(q\) => Math\.min\(maxQty, q \+ 1\)\)/);
  });

  it("lifts the cap for a pre-order, which is ordering what is not there", () => {
    expect(PI).toMatch(/const maxQty = canPreorder \? Infinity/);
  });

  it("stays clickable at the ceiling so it can say why", () => {
    /* The first version DISABLED the button, which meant the click handler
       never ran and the red line explaining the limit was unreachable --
       the button simply stopped responding, which is the thing being fixed
       rather than the fix. */
    expect(PI).not.toMatch(/aria-label="\+" disabled=/);
    expect(PI).toMatch(/aria-label="\+" aria-disabled=\{atCap\}/);
    expect(PI).toMatch(/if \(atCap\) \{ setCapHit\(true\); return; \}/);
  });

  it("names both numbers: what is there and what was asked for", () => {
    expect(PI).toMatch(/stockCapSize|stockCapNoSize/);
    expect(PI).toMatch(/\.replace\("\{n\}", String\(maxQty\)\)/);
    expect(PI).toMatch(/\.replace\("\{q\}", String\(qty \+ 1\)\)/);
  });

  it("drops a quantity that no longer fits when the size changes", () => {
    // Choosing 5 of a size with 8 left and then switching to one with 3
    // would otherwise offer an order the shop is bound to refuse.
    expect(PI).toMatch(/setQty\(\(q\) => Math\.min\(q, left\)\)/);
  });
});
