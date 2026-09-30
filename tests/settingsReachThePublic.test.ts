import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseNum, normalizeNumText } from "@/lib/numberInput";
import { taglineOf } from "@/lib/tagline";
import type { Settings } from "@/lib/types";

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

describe("prices print in dollars, and say so", () => {
  const STOREFRONT = [
    "src/components/ProductCard.tsx", "src/components/BasketView.tsx",
    "src/components/ProductInteractive.tsx",
    "src/components/MobileNav.tsx",
  ];

  it("uses the one formatter", () => {
    for (const f of STOREFRONT) {
      expect(code(f), `${f} prints money`).toMatch(/money\(/);
    }
  });

  it("offers no currency to choose", () => {
    /* Timor-Leste uses the dollar. A picker with five options was a
       question with one true answer, and the only thing it could do was be
       set wrong -- which it was, and which printed euro symbols over dollar
       figures until it was set back. */
    const settings = code("src/components/admin/SettingsAdmin.tsx");
    expect(settings).not.toMatch(/display_currency/);
    expect(settings).not.toMatch(/DISPLAY_CURRENCIES/);
  });

  it("keeps what an order was agreed in on the order", () => {
    // The column stays: an order written before this says dollars rather
    // than "unknown", and the day a shop here quotes in something else the
    // old ones are still legible.
    expect(code("src/lib/actions/orders.ts")).toMatch(/currency,/);
    expect(code("src/lib/actions/orders.ts")).toMatch(/fx_rate: 1/);
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
    /* The local is `n` rather than `left` now -- the rebuilt buy card
       computes `left` once for the button's label and again inside the
       click, and two bindings of one name in one scope is how a shadow
       becomes a bug. The rule is what matters and it is unchanged. */
    expect(PI).toMatch(/setQty\(\(q\) => Math\.min\(q, n\)\)/);
  });
});


/* THE HEADLINE THAT STAYED IN TETUN.
 *
 * Reported from a live shop: switch the language to Indonesian and
 * /id/shop showed an Indonesian breadcrumb, an Indonesian kicker and an
 * Indonesian description over a Tetun headline.
 *
 * The headline is the shop's TAGLINE, which is not a translated interface
 * string -- it is a particular shop's own words, one column per language.
 * Indonesian was added to lib/i18n.ts and there was no fourth column, so
 * taglineOf() fell back to Tetun exactly as designed. The fix is the
 * column, and a column is only fixed when the whole chain carries it: the
 * migration adds it, the grant lets anon read it, the storefront's select
 * asks for it, the form writes it, and taglineOf reads it. Every one of
 * those was missed at least once for the nine columns above.
 */
describe("the shop's own line reaches a reader in every language", () => {
  const MIGRATION = read("supabase/tagline-indonesian.sql");
  const ACTION = code("src/lib/actions/settings.ts");
  const FORM = code("src/components/admin/SettingsAdmin.tsx");
  const TAGLINE = code("src/lib/tagline.ts");

  it("adds the column and grants it to the browser's key", () => {
    // Added without a grant is worse than not added: settings is read with
    // column-by-column grants, and one ungranted column fails the WHOLE
    // select -- the shop would lose its name and its bank details.
    expect(MIGRATION).toMatch(/add column if not exists tagline_id/);
    expect(MIGRATION).toMatch(/grant select \(tagline_id\) on settings to anon/);
  });

  it("is safe to paste twice, like every other file in that folder", () => {
    expect(MIGRATION).toMatch(/add column if not exists/);
    // The backfill has to be idempotent too: a second run must not
    // overwrite a line the shop wrote in between.
    expect(MIGRATION).toMatch(/where coalesce\(tagline_id, ''\) = ''/);
  });

  it("only writes the demo line into a shop still carrying the demo line", () => {
    /* A shop that wrote its own tagline gets an empty box to fill in its
       own words, not a sentence about Dili it never wrote. Matched on the
       exact string seed.sql writes. */
    const seeded = /tagline_tet\s*=\s*'([^']+)'/.exec(read("supabase/seed.sql"))?.[1];
    expect(seeded, "seed.sql sets a Tetun tagline").toBeTruthy();
    expect(MIGRATION).toContain(`and tagline_tet = '${seeded}'`);
  });

  it("asks for it separately, so an un-migrated shop keeps its legal facts", () => {
    /* Folding it into SETTINGS_PUBLIC_EXTRAS would mean a shop that has
       not pasted this file loses its legal facts, currency and tax rate
       as well -- over a headline. Its own tier loses only the headline. */
    const extras = /const SETTINGS_PUBLIC_EXTRAS =\s*([\s\S]*?);/.exec(PUBLIC)?.[1] ?? "";
    expect(extras, "not folded in with the nine").not.toContain("tagline_id");
    expect(PUBLIC).toMatch(/const SETTINGS_TAGLINE_ID = ", tagline_id";/);
    expect(PUBLIC).toMatch(/SETTINGS_CORE \+ SETTINGS_PUBLIC_EXTRAS \+ SETTINGS_TAGLINE_ID/);
    // And the tier below it still asks for the nine.
    expect(PUBLIC).toMatch(/\.select\(SETTINGS_CORE \+ SETTINGS_PUBLIC_EXTRAS\)/);
  });

  it("saves it, and drops only it on a shop that lacks the column", () => {
    // Naming a column the database does not have fails the whole save, so
    // this one rides in the optional bag that writeTolerating can drop --
    // the other three taglines still save.
    expect(ACTION).toMatch(/tagline_tet: string; tagline_pt: string; tagline_en: string;/);
    expect(ACTION).toMatch(/tagline_id\?: string;/);
    expect(ACTION).toMatch(/tagline_id: tagline_id \?\? "",/);
  });

  it("gives every language a box, so the column is fillable", () => {
    // The reason there were three columns and no fourth: nothing wrote
    // them. A column nobody can fill is not a feature.
    for (const col of ["tagline_tet", "tagline_pt", "tagline_en", "tagline_id"]) {
      expect(FORM, col).toContain(`${col}: settings.${col} || ""`);
      expect(FORM, `${col} has a field`).toContain(`field("${col}"`);
    }
  });

  it("reads the column that matches the reader", () => {
    expect(TAGLINE).toMatch(/lang === "id" \? settings\.tagline_id/);
  });
});

describe("taglineOf", () => {
  const S = (over: Partial<Settings>) => ({
    tagline_tet: "Sasán loos.", tagline_pt: "Produtos reais.",
    tagline_en: "Real stock.", tagline_id: "Stok nyata.",
    ...over,
  } as Settings);

  it("answers in the language asked for", () => {
    expect(taglineOf(S({}), "tet")).toBe("Sasán loos.");
    expect(taglineOf(S({}), "pt")).toBe("Produtos reais.");
    expect(taglineOf(S({}), "en")).toBe("Real stock.");
    expect(taglineOf(S({}), "id")).toBe("Stok nyata.");
  });

  it("falls back to Tetum for a language the shop left blank", () => {
    // A shop that filled in one language has said something; a blank line
    // loses it for no reason.
    expect(taglineOf(S({ tagline_id: "" }), "id")).toBe("Sasán loos.");
  });

  it("falls back on a shop that has not run the migration at all", () => {
    // No column means undefined, not "", and undefined must not render as
    // the string "undefined" across the top of the catalogue.
    const noColumn = S({});
    delete (noColumn as { tagline_id?: string }).tagline_id;
    expect(taglineOf(noColumn, "id")).toBe("Sasán loos.");
  });

  it("returns empty rather than undefined when nothing is set", () => {
    expect(taglineOf(S({ tagline_tet: "", tagline_id: "" }), "id")).toBe("");
  });
});
