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
  it("gives the bare listing a canonical and no robots directive", () => {
    const m = listingMetadata({ title: "Catalog", path: "/shop", searchParams: {} });
    expect(m.alternates?.canonical).toBe("/shop");
    expect(m.robots).toBeUndefined();
  });

  it("noindexes a filtered view, and never also canonicalises it away", () => {
    // noindex plus a canonical pointing somewhere else are contradictory
    // instructions; sending both is how a page ends up ignored in a way
    // nobody intended. One or the other -- never both.
    const m = listingMetadata({ title: "Catalog", path: "/shop", searchParams: { sort: "new" } });
    expect(m.robots).toEqual({ index: false, follow: true });
    expect(m.alternates).toBeUndefined();
  });

  it("keeps follow on, so page 40 is still reachable", () => {
    const m = listingMetadata({ title: "Catalog", path: "/shop", searchParams: { page: "40" } });
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
