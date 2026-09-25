import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { descendantIds, depthOf, pathOf } from "@/lib/categoryTree";
import type { Category } from "@/lib/types";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const FOCUS = read("supabase/focus-taxonomy.sql");
const SEED = read("supabase/seed.sql");

const cat = (id: string, parent: string | null = null, order = 0): Category =>
  ({ id, name: id, slug: id, parent_id: parent, sort_order: order }) as Category;

/* THE TREE IS THREE DEEP NOW.
 *
 * Fitness & Wellness Lifestyle -> Sports Nutrition -> Protein. Four places
 * walked it exactly one level -- [id, ...children] -- which was right
 * while it was two deep and silently wrong the moment it was not: a tub of
 * protein counted towards Sports Nutrition and not towards the aisle above
 * it, so browsing Fitness & Wellness showed a number missing most of what
 * is in it. */

const TREE: Category[] = [
  cat("fitness", null, 0),
  cat("nutrition", "fitness", 0),
  cat("protein", "nutrition", 0),
  cat("creatine", "nutrition", 1),
  cat("supplements", "fitness", 1),
  cat("vitamins", "supplements", 0),
  cat("fashion", null, 1),
  cat("mens", "fashion", 0),
];

describe("descendantIds", () => {
  it("reaches the grandchildren, not just the children", () => {
    expect(descendantIds(TREE, "fitness")).toEqual([
      "fitness", "nutrition", "protein", "creatine", "supplements", "vitamins",
    ]);
  });

  it("includes the category itself", () => {
    expect(descendantIds(TREE, "protein")).toEqual(["protein"]);
  });

  it("stops at the branch it was asked about", () => {
    expect(descendantIds(TREE, "nutrition")).toEqual(["nutrition", "protein", "creatine"]);
    expect(descendantIds(TREE, "nutrition")).not.toContain("vitamins");
  });

  it("returns children in the order the shop put them", () => {
    const shuffled = [cat("a"), cat("z", "a", 9), cat("m", "a", 1)];
    expect(descendantIds(shuffled, "a")).toEqual(["a", "m", "z"]);
  });

  it("is just itself for a category the tree does not have", () => {
    expect(descendantIds(TREE, "nope")).toEqual(["nope"]);
  });

  it("terminates on a parent cycle rather than hanging", () => {
    /* NOT DEFENSIVE PROGRAMMING. parent_id is a plain self-reference with
       no constraint against a cycle, and the admin's move button writes
       parent_id -- so A under B under A is two clicks away, and without
       the visited set the storefront would hang rather than render a
       wrong number. */
    const loop = [cat("a", "b"), cat("b", "a")];
    expect(descendantIds(loop, "a").length).toBeLessThanOrEqual(2);
  });
});

describe("depthOf", () => {
  it("counts the levels above a category", () => {
    expect(depthOf(TREE, "fitness")).toBe(0);
    expect(depthOf(TREE, "nutrition")).toBe(1);
    expect(depthOf(TREE, "protein")).toBe(2);
  });

  it("terminates on a cycle", () => {
    const loop = [cat("a", "b"), cat("b", "a")];
    expect(depthOf(loop, "a")).toBeLessThanOrEqual(2);
  });
});

describe("pathOf", () => {
  it("is the trail from the root down, in order", () => {
    expect(pathOf(TREE, "protein").map((c) => c.id))
      .toEqual(["fitness", "nutrition", "protein"]);
  });

  it("is one entry for a root", () => {
    expect(pathOf(TREE, "fashion").map((c) => c.id)).toEqual(["fashion"]);
  });

  it("is empty for a category the tree does not have", () => {
    expect(pathOf(TREE, "nope")).toEqual([]);
  });

  it("terminates on a cycle", () => {
    const loop = [cat("a", "b"), cat("b", "a")];
    expect(pathOf(loop, "a").length).toBeLessThanOrEqual(2);
  });
});

describe("nothing walks the tree one level deep any more", () => {
  it("has no [id, ...children] left in the storefront or the admin", () => {
    for (const f of ["src/components/Sidebar.tsx", "src/components/CatRail.tsx",
                     "src/components/admin/CategoriesAdmin.tsx", "src/lib/nav.ts"]) {
      expect(read(f), f).not.toMatch(/\[id, \.\.\.(cats|childrenOf)/);
      expect(read(f), f).toContain("descendantIds");
    }
  });
});

describe("the focused catalogue", () => {
  it("builds the four aisles this shop sells", () => {
    for (const slug of ["fashion_apparel", "shoes_footwear", "accessories", "fitness_wellness"]) {
      expect(FOCUS, slug).toContain(`'${slug}'`);
    }
  });

  it("puts the third level under Sports Nutrition", () => {
    expect(FOCUS).toContain("('Protein', 'protein', 'sports_nutrition', 0)");
    expect(FOCUS).toContain("('Vitamins', 'vitamins', 'dietary_supplements', 0)");
  });

  it("upserts rather than skipping, so an existing slug can be moved", () => {
    /* accessories and gym_accessories already exist as TOP-LEVEL
       categories, and gym_accessories has to move under Fitness &
       Wellness. "do nothing" would leave it where it was. */
    expect(FOCUS).toContain("on conflict (seller_id, slug) do update");
    expect(FOCUS).not.toContain("on conflict (seller_id, slug) do nothing");
  });

  it("moves the product types before deleting what holds them", () => {
    // product_types cascades from categories.
    const move = FOCUS.indexOf("update product_types pt");
    const drop = FOCUS.indexOf("delete from categories c");
    expect(move).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(move);
  });

  it("never deletes a category holding a product, a line or a used type", () => {
    expect(FOCUS).toContain("not exists (select 1 from products p where p.category_id = c.id)");
    expect(FOCUS).toContain("not exists (select 1 from purchase_order_items i where i.catalog_category_id = c.id)");
    expect(FOCUS).toMatch(/from product_types t\s*\n\s*join products p on p\.product_type_id = t\.id/);
  });

  it("deletes until it settles rather than a fixed two passes", () => {
    // Emptying a child can leave its parent deletable, and that can
    // cascade further up than two levels now the tree is three deep.
    expect(FOCUS).toContain("exit when not found;");
  });

  it("stops the sample data regrowing the aisles it just cleared", () => {
    /* seed.sql runs AFTER this file and used to re-create Sapatu, Roupa
       and Telemóvel on every single run -- a category list that regrows
       what you removed is one nobody can curate. */
    expect(SEED).not.toContain("'sapatu'");
    expect(SEED).not.toContain("'roupa'");
    expect(SEED).not.toContain("'telemovel'");
    expect(SEED).toContain("'sports_shoes'");
  });
});
