import { describe, it, expect } from "vitest";
import {
  parseAttributeFilters, attributeFilterParams, toggleFilter,
  hasFilters, intersectIds, ATTR_PREFIX,
} from "@/lib/attributeFilterParams";

describe("reading filters out of the address", () => {
  it("takes only the namespaced parameters", () => {
    // sort, page and in belong to the catalogue and must not become
    // attribute filters -- and a future attribute called "sort" must not
    // collide with them either.
    const f = parseAttributeFilters({
      a_color: "Black", a_material: "Leather",
      sort: "low", page: "2", in: "1",
    });
    expect(f).toEqual({ color: ["Black"], material: ["Leather"] });
  });

  it("accepts repeated and comma-separated alike", () => {
    expect(parseAttributeFilters({ a_color: "Black,White" }))
      .toEqual({ color: ["Black", "White"] });
    expect(parseAttributeFilters({ a_color: ["Black", "White"] }))
      .toEqual({ color: ["Black", "White"] });
  });

  it("drops blanks, trims, and collapses duplicates", () => {
    expect(parseAttributeFilters({ a_color: " Black , ,Black, White " }))
      .toEqual({ color: ["Black", "White"] });
  });

  it("ignores a prefix with no attribute after it", () => {
    expect(parseAttributeFilters({ [ATTR_PREFIX]: "Black" })).toEqual({});
  });

  it("ignores an attribute whose values are all empty", () => {
    expect(parseAttributeFilters({ a_color: " , " })).toEqual({});
  });

  it("round-trips back into parameters", () => {
    const f = { color: ["Black", "White"], material: ["Leather"] };
    expect(attributeFilterParams(f))
      .toEqual({ a_color: "Black,White", a_material: "Leather" });
    expect(parseAttributeFilters(attributeFilterParams(f))).toEqual(f);
  });
});

describe("ticking a box", () => {
  it("adds a value and removes it again", () => {
    let f = toggleFilter({}, "color", "Black");
    expect(f).toEqual({ color: ["Black"] });
    f = toggleFilter(f, "color", "White");
    expect(f).toEqual({ color: ["Black", "White"] });
    f = toggleFilter(f, "color", "Black");
    expect(f).toEqual({ color: ["White"] });
  });

  it("removes the attribute entirely when its last value goes", () => {
    // Leaving the key behind would put ?a_color= in the address for
    // nothing.
    expect(toggleFilter({ color: ["Black"] }, "color", "Black")).toEqual({});
  });

  it("does not mutate what it was given", () => {
    const before = { color: ["Black"] };
    toggleFilter(before, "color", "White");
    expect(before).toEqual({ color: ["Black"] });
  });

  it("knows when nothing is filtered", () => {
    expect(hasFilters({})).toBe(false);
    expect(hasFilters({ color: [] })).toBe(false);
    expect(hasFilters({ color: ["Black"] })).toBe(true);
  });
});

describe("intersecting the groups", () => {
  /* THE RULE THAT IS EASY TO GET BACKWARDS. Values within one attribute
     are OR -- black or white shirts. Different attributes are AND -- black
     LEATHER, not everything black plus everything leather. Reversed, the
     results widen as you narrow the filter, which looks like it works
     until the catalogue is big enough to notice. */

  it("keeps only what every group has", () => {
    expect(intersectIds([["a", "b", "c"], ["b", "c", "d"], ["c", "b"]])!.sort())
      .toEqual(["b", "c"]);
  });

  it("returns null for no groups, meaning no filter at all", () => {
    // Not an empty array: that would mean "nothing matched" and empty the
    // whole catalogue the moment somebody visited without filters.
    expect(intersectIds([])).toBeNull();
  });

  it("returns empty for a group that matched nothing", () => {
    // Which IS "nothing matched", and correctly shows nothing.
    expect(intersectIds([["a", "b"], []])).toEqual([]);
  });

  it("handles a single group", () => {
    expect(intersectIds([["a", "b"]])!.sort()).toEqual(["a", "b"]);
  });

  it("returns empty when the groups do not overlap", () => {
    expect(intersectIds([["a"], ["b"]])).toEqual([]);
  });

  it("does not mutate the groups it was given", () => {
    const g = [["b", "a"], ["a"]];
    intersectIds(g);
    expect(g).toEqual([["b", "a"], ["a"]]);
  });
});
