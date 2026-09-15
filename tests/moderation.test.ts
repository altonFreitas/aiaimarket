import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canSee, sectionForPath } from "@/lib/adminSections";

/* THE TWO LOCKS ON ONE SCREEN.
 *
 * /admin/reviews shows product reviews AND store ratings, and they answer
 * to different sections: a product review is a property of a product
 * (Catalog), a rating is about a store (Sellers). The page is guarded on
 * Catalog and hides the ratings half from an account without Sellers --
 * but hiding is not a lock, so deleteSellerRating has to check for itself.
 *
 * This reads the source rather than restating it, because the failure
 * being guarded against is somebody later "tidying" the two guards into
 * one and quietly handing store ratings to a catalog-only account.
 */

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const ACTIONS = read("src/lib/actions/moderation.ts");
const PAGE = read("src/app/admin/reviews/page.tsx");

describe("review moderation", () => {
  it("guards each delete with the section that thing belongs to", () => {
    const forReview = /deleteProductReview[\s\S]*?requireSection\(\s*"([a-z]+)"/.exec(ACTIONS);
    const forRating = /deleteSellerRating[\s\S]*?requireSection\(\s*"([a-z]+)"/.exec(ACTIONS);
    expect(forReview?.[1]).toBe("catalog");
    expect(forRating?.[1]).toBe("sellers");
  });

  it("copies the row into the audit trail before deleting it", () => {
    // Removing what a customer said about a shop has to leave a record of
    // who did it and what it said -- otherwise "we moderate abuse" and
    // "we delete anything under four stars" look identical afterwards.
    for (const action of ["review.delete", "rating.delete"]) {
      expect([action, ACTIONS.includes(action)]).toEqual([action, true]);
    }
    expect(ACTIONS).toMatch(/select\([^)]*\)[\s\S]{0,200}\.delete\(\)/);
    expect(ACTIONS).toMatch(/meta:\s*\{\s*deleted:/);
  });

  it("does not draw the ratings half for an account without Sellers", () => {
    expect(PAGE).toMatch(/canSee\(actor,\s*"sellers"\)\s*\?\s*ratings\s*:\s*null/);
  });

  it("files the page under Catalog, where its guard says it is", () => {
    expect(sectionForPath("/admin/reviews")).toBe("catalog");
    // The guard names the TAB now, not the area: somebody granted only
    // Stock inside Catalog must not reach reviews.
    const guard = /requireSection\(\s*"([a-z.]+)"/.exec(PAGE);
    expect(guard?.[1]).toBe("catalog.reviews");
  });

  it("means a catalog-only account can open the page and not the ratings", () => {
    const catalogOnly = { kind: "staff", sections: ["catalog"], role: "admin" } as Parameters<typeof canSee>[0];
    expect(canSee(catalogOnly, "catalog")).toBe(true);
    expect(canSee(catalogOnly, "sellers")).toBe(false);
  });
});
