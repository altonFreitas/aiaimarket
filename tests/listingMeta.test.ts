import { describe, it, expect } from "vitest";
import { isFilteredListing, listingMetadata, searchMetadata } from "../src/lib/listingMeta";

describe("isFilteredListing", () => {
  it("says no for the bare listing", () => {
    expect(isFilteredListing({})).toBe(false);
  });

  it("says no for page=1, which the paginator itself links to", () => {
    // The first page IS the listing. Treating "?page=1" as a variant would
    // noindex a URL the app's own "previous" link points at.
    expect(isFilteredListing({ page: "1" })).toBe(false);
  });

  it("says yes for every dimension the grid accepts", () => {
    for (const sp of [
      { sort: "price_asc" }, { in: "1" }, { min: "5" },
      { max: "50" }, { for: "women" }, { page: "2" },
    ]) {
      expect([sp, isFilteredListing(sp)]).toEqual([sp, true]);
    }
  });
});

describe("listingMetadata", () => {
  it("gives the bare listing a canonical to ITSELF, in its own language", () => {
    // Self-referencing, not pointed at the unprefixed URL. Three languages
    // canonicalising to one would tell Google to index only that one --
    // which is the bug the locale prefixes exist to fix.
    const tet = listingMetadata({ title: "Catalog", path: "/shop", searchParams: {}, lang: "tet" });
    const pt = listingMetadata({ title: "Catálogo", path: "/shop", searchParams: {}, lang: "pt" });
    expect(tet.alternates?.canonical).toBe("/tet/shop");
    expect(pt.alternates?.canonical).toBe("/pt/shop");
    expect(tet.robots).toBeUndefined();
  });

  it("names the other two languages as alternates", () => {
    const m = listingMetadata({ title: "Catalog", path: "/shop", searchParams: {}, lang: "en" });
    expect(m.alternates?.languages).toEqual({
      tet: "/tet/shop",
      "pt-TL": "/pt/shop",
      en: "/en/shop",
      "x-default": "/tet/shop",
    });
  });

  it("noindexes a filtered view, and never also canonicalises it away", () => {
    // noindex plus a canonical pointing somewhere else are contradictory
    // instructions; sending both is how a page ends up ignored in a way
    // nobody intended. One or the other -- never both.
    const m = listingMetadata({ title: "Catalog", path: "/shop", searchParams: { sort: "new" }, lang: "tet" });
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.alternates).toBeUndefined();
  });

  it("keeps follow on, so page 40 is still reachable", () => {
    const m = listingMetadata({ title: "Catalog", path: "/shop", searchParams: { page: "40" }, lang: "tet" });
    expect(m.robots).toEqual({ index: false, follow: true });
  });
});

describe("searchMetadata", () => {
  it("is noindex whatever was typed", () => {
    // A results page is generated from a stranger's query. Indexed, the
    // shop acquires pages titled after whatever anyone typed into the box.
    expect(searchMetadata("Search: boots").robots).toEqual({ index: false, follow: true });
    expect(searchMetadata("Search").robots).toEqual({ index: false, follow: true });
  });
});
