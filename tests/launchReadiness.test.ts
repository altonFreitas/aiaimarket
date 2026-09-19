import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openChecks, siteUrlOk, unfinishedLegal } from "@/lib/launchReadiness";
import {
  LEGAL_DOCS, LEGAL_MOVED, fillLegal, hasPlaceholders, legalVars, pick,
  type LegalSlug, type LegalVars,
} from "@/lib/legal";

const ROOT = path.join(__dirname, "..");
const GOOD = { siteUrl: "https://loja.tl", storeName: "Loja AIAI", contact: "+67077000000" };

/* A shop that has not yet told the policies anything about itself -- which
   is every shop on the day it installs this. */
const BLANK: LegalVars = { store: "Loja AIAI", contact: "+67077000000" };

/* And one that has. These are the five facts no author could supply: where
   it trades, what it is registered as, and the three periods it commits to. */
const FILLED: LegalVars = legalVars({
  store_name: "Loja AIAI", wa_number: "+67077000000",
  legal_address: "Rua Caicoli, Dili",
  legal_registration: "SERVE 12345",
  legal_retention_years: 7, legal_return_days: 14, legal_refund_days: 7,
});

describe("siteUrlOk", () => {
  it("accepts a real site", () => {
    expect(siteUrlOk("https://loja.tl")).toBe(true);
    expect(siteUrlOk("https://loja.tl/")).toBe(true);
    expect(siteUrlOk("http://loja.tl")).toBe(true);
  });

  it("rejects unset", () => {
    expect(siteUrlOk("")).toBe(false);
    expect(siteUrlOk("   ")).toBe(false);
  });

  it("rejects the development default", () => {
    // THE ONE THAT MATTERS. layout.tsx, sitemap.ts and robots.ts all fall
    // back to this string, so a shop deployed without the variable set does
    // not fail to build -- it publishes canonical URLs and a sitemap
    // pointing at the owner's laptop, and Google indexes them.
    expect(siteUrlOk("http://localhost:3000")).toBe(false);
    expect(siteUrlOk("http://127.0.0.1:3000")).toBe(false);
    expect(siteUrlOk("http://0.0.0.0:3000")).toBe(false);
    expect(siteUrlOk("http://[::1]:3000")).toBe(false);
  });

  it("is not fooled by a real host that merely starts with the same letters", () => {
    expect(siteUrlOk("https://localhost.tl")).toBe(true);
    expect(siteUrlOk("https://127.0.0.1.example.com")).toBe(true);
  });

  it("rejects a bare hostname, which is not an origin", () => {
    // trackingUrl() builds an absolute link by concatenation; "loja.tl/o/AB"
    // is a relative path, and a relative path in a WhatsApp message is not
    // tappable. That is exactly what notifyOrderEvent() refuses to send.
    expect(siteUrlOk("loja.tl")).toBe(false);
  });
});

describe("openChecks", () => {
  it("passes nothing back when everything is set", () => {
    // With the five legal facts supplied, nothing is outstanding. This used
    // to carve out the policy pages as permanently failing, because
    // hasPlaceholders read the raw source text and the markers live there --
    // it could never pass. Now it passes exactly when the shop has done the
    // work, which is the only version of this check worth having.
    const bad = openChecks({ ...GOOD, legal: FILLED }).filter((c) => !c.ok).map((c) => c.key);
    expect(bad).toEqual([]);
  });

  it("catches an unset site address", () => {
    const c = openChecks({ ...GOOD, siteUrl: "" }).find((x) => x.key === "readySiteUrl")!;
    expect(c.ok).toBe(false);
    // The variable is named, because "your site address" is not something an
    // owner can act on and NEXT_PUBLIC_SITE_URL is.
    expect(c.detail).toBe("NEXT_PUBLIC_SITE_URL");
  });

  it("shows the wrong value back when there is one", () => {
    const c = openChecks({ ...GOOD, siteUrl: "http://localhost:3000" })
      .find((x) => x.key === "readySiteUrl")!;
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("localhost:3000");
  });

  it("catches an empty store name and contact", () => {
    const out = openChecks({ ...GOOD, storeName: "  ", contact: "" });
    expect(out.find((c) => c.key === "readyStoreName")!.ok).toBe(false);
    expect(out.find((c) => c.key === "readyContact")!.ok).toBe(false);
  });

  it("names the policy pages a shopper would land on", () => {
    const c = openChecks({ ...GOOD, legal: BLANK }).find((x) => x.key === "readyLegal")!;
    for (const slug of unfinishedLegal(BLANK)) expect(c.detail).toContain(`/legal/${slug}`);
  });

  it("has every check say what to do about it", () => {
    for (const c of openChecks({ siteUrl: "", storeName: "", contact: "" })) {
      expect([c.key, c.fixKey.length > 0, c.detail.length > 0]).toEqual([c.key, true, true]);
    }
  });
});

describe("what the checks are actually about", () => {
  it("proves an empty store name and contact reach a shopper", () => {
    // Not a check of the checker -- a check of the thing it is checking.
    // If fillLegal ever stops substituting these, the readiness rows become
    // busywork and this fails.
    const all = (Object.keys(LEGAL_DOCS) as LegalSlug[]).flatMap((slug) => {
      const d = LEGAL_DOCS[slug];
      return [pick(d.intro, "en"), ...d.sections.flatMap((x) => x.body.map((b) => pick(b, "en")))];
    });
    const withStore = all.filter((l) => l.includes("{STORE}"));
    expect(withStore.length).toBeGreaterThan(0);
    for (const line of withStore) {
      expect(fillLegal(line, { store: "", contact: "" })).not.toContain("{STORE}");
    }
    // The em dash is what a shopper is told to contact about their data.
    expect(fillLegal("Contact: {CONTACT}.", { store: "x", contact: "" })).toBe("Contact: —.");
  });

  it("calls every policy unfinished until the shop fills its facts in", () => {
    /* The state every shop is in on day one. Two pages, not three: the
       privacy text is the second half of the terms page now, so its
       unfilled markers are reported against "terms". */
    expect(unfinishedLegal(BLANK).sort()).toEqual(["returns", "terms"]);
  });

  it("calls them finished once it has", () => {
    expect(unfinishedLegal(FILLED)).toEqual([]);
  });

  it("leaves an unanswered marker standing rather than blanking it", () => {
    /* THE DANGEROUS ALTERNATIVE. Substituting an empty string would produce
       "We keep order records for  years" -- a sentence that reads as
       finished, on a public policy page, committing the shop to nothing it
       can point at. The marker stays so it is visibly unfinished. */
    const line = "We keep order records for {RETENTION YEARS — FILL IN} years.";
    expect(fillLegal(line, BLANK)).toContain("FILL IN");
    expect(fillLegal(line, FILLED)).toBe("We keep order records for 7 years.");
  });

  it("does not let one filled-in fact finish a page on its own", () => {
    // terms needs BOTH the address and the registration.
    const half = { ...BLANK, address: "Rua Caicoli, Dili" };
    expect(unfinishedLegal(half)).toContain("terms");
  });

  it("agrees with hasPlaceholders about which pages are unfinished", () => {
    const byDoc = (Object.keys(LEGAL_DOCS) as LegalSlug[])
      .filter((s) => hasPlaceholders(LEGAL_DOCS[s], BLANK));
    expect(unfinishedLegal(BLANK)).toEqual(byDoc);
  });

  it("still describes the fallback the app really uses", () => {
    // siteUrlOk rejects localhost because three files fall back to it. If
    // that default is ever changed, this list is where the mismatch shows.
    for (const rel of ["src/app/layout.tsx", "src/app/sitemap.ts", "src/app/robots.ts"]) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect([rel, /NEXT_PUBLIC_SITE_URL \|\| "http:\/\/localhost:3000"/.test(src)])
        .toEqual([rel, true]);
    }
  });

  it("does not restate what the panels below it already say", () => {
    // The owner's rule for this dashboard, kept as a test rather than as an
    // intention: payment credentials and outstanding SQL have panels of
    // their own, and two places to read one fact is one place to forget.
    const src = fs.readFileSync(path.join(ROOT, "src/lib/launchReadiness.ts"), "utf8");
    const code = src.split("\n").filter((l) => !l.trim().startsWith("*")).join("\n");
    for (const word of ["MPGS_", "PAYMENT_METHODS", "SCHEMA_FEATURES", "schema_inventory"]) {
      expect([word, code.includes(word)]).toEqual([word, false]);
    }
  });
});

describe("terms and privacy, joined", () => {
  /* THE RISK OF MERGING TWO DOCUMENTS BY CONCATENATION is that the join is
     silent: drop a spread and the page still renders, still passes a type
     check, and is simply missing the half nobody looked at. A shop
     publishing terms where its privacy policy used to be is a legal
     problem, not a layout one, so the seam is checked rather than trusted. */

  it("still publishes the privacy text, inside the terms page", () => {
    const terms = LEGAL_DOCS.terms;
    const headings = terms.sections.map((s) => s.heading[2]);
    // From the terms half...
    expect(headings).toContain("Who we are");
    // ...and from the privacy half, which used to be its own page.
    expect(headings).toContain("What we keep");
  });

  it("gives the privacy half an anchor to be linked to", () => {
    /* /legal/privacy is on receipts, in the cookie banner and in whatever
       a payment provider filed. It redirects here, and has to land on the
       privacy heading rather than the top of a long page. */
    const anchored = LEGAL_DOCS.terms.sections.filter((s) => s.id);
    expect(anchored).toHaveLength(1);
    expect(anchored[0].id).toBe("privacy");
    expect(LEGAL_MOVED.privacy).toBe("/legal/terms#privacy");
  });

  it("keeps the old URL resolving rather than 404ing", () => {
    // A slug that is no longer a document must still be a route, or every
    // link ever printed to it breaks.
    expect(Object.keys(LEGAL_DOCS)).not.toContain("privacy");
    expect(LEGAL_MOVED.privacy).toBeTruthy();
    expect(LEGAL_MOVED.privacy.startsWith("/legal/")).toBe(true);
  });

  it("reports a privacy FILL IN against the page that now carries it", () => {
    /* The marker that only ever appears in the privacy text. If the merge
       dropped that half, this passes vacuously -- so the heading check
       above is what makes this one mean something. */
    expect(hasPlaceholders(LEGAL_DOCS.terms, BLANK)).toBe(true);
    expect(hasPlaceholders(LEGAL_DOCS.terms, FILLED)).toBe(false);
  });

  it("does not leave the shop with a title that names only half of it", () => {
    for (const lang of [0, 1, 2] as const) {
      expect(LEGAL_DOCS.terms.title[lang].length).toBeGreaterThan(0);
    }
    expect(LEGAL_DOCS.terms.title[2].toLowerCase()).toContain("privacy");
  });
});
