import { describe, it, expect } from "vitest";
import {
  AUDIENCES, normalizeAudience, parseAudienceFilter, matchesAudience,
} from "@/lib/audience";

describe("normalizeAudience", () => {
  it("keeps the three it knows", () => {
    for (const a of AUDIENCES) expect(normalizeAudience(a)).toBe(a);
  });

  it("tolerates how a value might have been typed or stored", () => {
    expect(normalizeAudience("Men")).toBe("men");
    expect(normalizeAudience("WOMEN")).toBe("women");
    expect(normalizeAudience("  unisex  ")).toBe("unisex");
  });

  it("reads anything else as nobody having said", () => {
    // Including the shape a product row has on a database that has not run
    // supabase/audience.sql: the column is simply absent.
    for (const v of [null, undefined, "", "male", "kids", "boy", 1, {}, []]) {
      expect(normalizeAudience(v)).toBeNull();
    }
  });
});

describe("parseAudienceFilter", () => {
  it("accepts the two a shopper can pick", () => {
    expect(parseAudienceFilter("men")).toBe("men");
    expect(parseAudienceFilter("women")).toBe("women");
  });

  it("treats unisex in the address bar as no filter", () => {
    // Nobody shops for "clothes that are for either". Answering it with an
    // empty shelf would be worse than answering it with everything.
    expect(parseAudienceFilter("unisex")).toBeNull();
  });

  it("ignores junk rather than showing nothing", () => {
    for (const v of [undefined, null, "", "everyone", "MEN'S", "1"]) {
      const out = parseAudienceFilter(v);
      expect(out === null || out === "men").toBe(true);
    }
    expect(parseAudienceFilter("everyone")).toBeNull();
  });
});

describe("matchesAudience", () => {
  it("shows everything when nothing is asked for", () => {
    for (const p of ["men", "women", "unisex", null] as const) {
      expect(matchesAudience(p, null)).toBe(true);
    }
  });

  it("shows that audience", () => {
    expect(matchesAudience("men", "men")).toBe(true);
    expect(matchesAudience("women", "women")).toBe(true);
  });

  it("hides the other one", () => {
    expect(matchesAudience("women", "men")).toBe(false);
    expect(matchesAudience("men", "women")).toBe(false);
  });

  it("shows unisex under both", () => {
    // A shopper filtering to men is saying what they want to wear, not
    // asking to be shown less.
    expect(matchesAudience("unisex", "men")).toBe(true);
    expect(matchesAudience("unisex", "women")).toBe(true);
  });

  it("hides the unlabelled ones once a filter is set", () => {
    // The distinction that makes the filter worth having. If unset meant
    // unisex, every product predating this feature would appear under both
    // filters and the filter would do nothing on the day it shipped.
    expect(matchesAudience(null, "men")).toBe(false);
    expect(matchesAudience(null, "women")).toBe(false);
    expect(matchesAudience(null, null)).toBe(true);
  });
});
