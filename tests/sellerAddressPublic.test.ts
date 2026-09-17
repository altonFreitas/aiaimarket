import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* A SELLER'S ADDRESS IS THEIRS UNTIL THEY SAY OTHERWISE.
 *
 * The store page can now pin a seller's street on a map. The address it
 * pins was typed into a registration form long before that page existed,
 * by somebody who may be trading out of their own house -- so publishing it
 * needs their answer, and the absence of an answer is a no.
 *
 * Every rule below is one somebody could remove in a refactor without any
 * other test noticing, and the cost of removing one is a home address on a
 * public web page. They are read out of the source and the SQL because the
 * read path needs a database, and because what matters is that the rule is
 * still WRITTEN DOWN in the place that enforces it.
 */

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** Source with comments stripped: prose explaining a rule is not the rule.
 * Checking the raw file lets an explanation vouch for code that says
 * something else -- which is a mistake made twice already in this repo. */
const code = (rel: string) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const SQL = read("supabase/seller-address-public.sql");
const PUBLIC = code("src/lib/data/public.ts");
const FORM = code("src/components/seller/SellerSettingsForm.tsx");
const ACTION = code("src/lib/actions/seller-settings.ts");
const STORE = code("src/app/store/[slug]/page.tsx");

describe("the column records consent, and its absence", () => {
  it("defaults to false", () => {
    /* THE ONE THAT MATTERS MOST. A default of true publishes the address of
       every store on the marketplace the moment the migration runs, with
       nothing on any screen saying it happened. */
    expect(SQL).toMatch(/address_public boolean not null default false/);
  });

  it("is not null, so there is no third state", () => {
    // Null would mean "we do not know whether they agreed", and any code
    // reading that as yes is the same leak by a slower route.
    expect(SQL).toMatch(/not null/);
  });

  it("adds the column without touching what the public may read", () => {
    /* The obvious shortcut is to add `address` to the anon column grant and
       let the app decide. A column grant cannot be conditional, so that
       publishes every seller's address to anybody holding the anon key --
       which is in the browser -- and leaves the flag as decoration. */
    expect(SQL).not.toMatch(/grant\s+select[\s\S]*address/i);
    const schema = read("supabase/schema.sql");
    const grant = /grant select \(([^)]*)\)\s*\n?\s*on sellers/.exec(schema);
    expect(grant, "the public column grant on sellers").not.toBeNull();
    expect(grant![1]).not.toMatch(/\baddress\b/);
  });
});

describe("the reader withholds it unless two answers agree", () => {
  const fn = PUBLIC.slice(
    PUBLIC.indexOf("export async function getSellerPublicAddress"),
    PUBLIC.indexOf("export interface SellerReview"));

  it("exists at all", () => {
    expect(fn.length).toBeGreaterThan(0);
  });

  it("returns nothing unless the seller ticked the box", () => {
    // `!== true` rather than a falsy check: undefined arrives from a
    // database that has not run the migration, and that is not consent.
    expect(fn).toMatch(/address_public !== true/);
    expect(fn).toMatch(/return null/);
  });

  it("checks the store is approved, because the service role skips RLS", () => {
    /* getSellerBySlug reads with the ANON key and row-level security does
       the approved-only filtering for it. This one cannot -- the address is
       not granted to anon, so it needs the service role, and the service
       role reads past RLS. Losing this line would publish the address of a
       suspended or pending store. */
    expect(fn).toMatch(/supabaseAdmin\(\)/);
    expect(fn).toMatch(/status !== "approved"/);
  });

  it("was not folded into the function the storefront depends on", () => {
    // Making getSellerBySlug use the service role would have silently
    // dropped its RLS filter for every field, not just this one.
    const slugFn = PUBLIC.slice(
      PUBLIC.indexOf("export async function getSellerBySlug"),
      PUBLIC.indexOf("export async function getSellerPublicAddress"));
    expect(slugFn).toMatch(/supabaseAnon\(\)/);
    expect(slugFn).not.toMatch(/supabaseAdmin/);
    expect(slugFn).not.toMatch(/address/);
  });

  it("says nothing rather than something on an error", () => {
    expect(fn).toMatch(/catch \{[\s\S]*return null/);
  });
});

describe("the seller is the one who decides", () => {
  it("offers the switch on their own settings screen", () => {
    expect(FORM).toMatch(/sellerAddressPublic/);
    expect(FORM).toMatch(/checked=\{addressPublic\}/);
  });

  it("starts off for a seller who was never asked", () => {
    // `=== true` so a row from before the column existed reads as off.
    expect(FORM).toMatch(/seller\.address_public === true/);
  });

  it("sends the choice when they save", () => {
    expect(FORM).toMatch(/addressPublic,/);
    expect(ACTION).toMatch(/address_public: !!input\.addressPublic/);
  });
});

describe("the store page", () => {
  it("pins the published address when there is one", () => {
    expect(STORE).toMatch(/getSellerPublicAddress\(seller\.id\)/);
    expect(STORE).toMatch(/parts=\{\[publicAddress, seller\.city, seller\.country\]\}/);
  });

  it("still shows only the city and country as words", () => {
    // The street is what the pin searches, not what the page prints: a full
    // address does not fit a line that also carries the product count.
    expect(STORE).toMatch(/label=\{\[seller\.city, seller\.country\]/);
  });
});
