import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_ORDER, NOT_SCHEMA_FILES } from "@/lib/schemaHealth";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const SEED = read("supabase/taxonomy-seed.sql");
const MIGRATION = read("supabase/clothing-taxonomy.sql");

/* CLOTHING IS THE AISLE, MEN'S AND WOMEN'S ARE INSIDE IT.
 *
 * The seeded tree had it the other way up: Men's Clothing and Women's
 * Clothing were top-level categories, each holding ONE subcategory called
 * "Clothing" which held all the product types. So the word a shopper
 * thinks in sat one level below an answer to a question nobody had asked,
 * twice, under two different parents.
 *
 * Two files have to agree about the new shape and they are written
 * differently: the seed builds it for a shop installing today, the
 * migration reshapes one that pasted the old seed months ago. These are
 * the assertions that keep them from drifting. */

describe("the seed builds Clothing as the aisle", () => {
  it("has one top-level Clothing, not a gendered pair", () => {
    expect(SEED).toContain("('Clothing', 'clothing', 0),");
    // The old top-level rows are gone from the top-level VALUES list.
    expect(SEED).not.toContain("('Men''s Clothing', 'men_s_clothing', 0),");
    expect(SEED).not.toContain("('Women''s Clothing', 'women_s_clothing', 1),");
  });

  it("hangs the gendered pair off it as subcategories", () => {
    expect(SEED).toContain("('Men''s Clothing', 'men_s_clothing', 'clothing', 0),");
    expect(SEED).toContain("('Women''s Clothing', 'women_s_clothing', 'clothing', 1),");
  });

  it("leaves no trace of the subcategory that used to hold everything", () => {
    /* A single surviving `men_s_clothing__clothing` would be a product type
       filed under a category the seed no longer creates -- the join that
       places it finds no row, and the type is silently not seeded. */
    expect(SEED).not.toContain("men_s_clothing__clothing");
    expect(SEED).not.toContain("women_s_clothing__clothing");
  });

  it("files the clothing product types on the gendered categories now", () => {
    expect(SEED).toContain("('T-Shirts', 't_shirts', 'men_s_clothing', 0),");
  });
});

describe("the migration moves what is filed rather than asking anyone to refile it", () => {
  it("moves the product types up BEFORE deleting what holds them", () => {
    /* product_types cascades from categories. Deleting the old
       subcategory first would take all 32 clothing types with it, and the
       shop would find out by opening the product form. */
    const moveTypes = MIGRATION.indexOf("update product_types pt");
    const dropSub = MIGRATION.indexOf("delete from categories where id = v_old_sub");
    expect(moveTypes).toBeGreaterThan(-1);
    expect(dropSub).toBeGreaterThan(-1);
    expect(moveTypes).toBeLessThan(dropSub);
  });

  it("carries the products and the purchase order lines with them", () => {
    expect(MIGRATION).toMatch(/update products\s+set category_id = v_gendered/);
    expect(MIGRATION).toMatch(/update purchase_order_items\s+set catalog_category_id = v_gendered/);
  });

  it("reuses a Clothing that is already there", () => {
    // What makes a second run a no-op rather than a duplicate-key error on
    // the unique (seller_id, slug).
    expect(MIGRATION).toContain("if v_clothing is null then");
  });

  it("runs per seller, because categories are", () => {
    expect(MIGRATION).toContain("select distinct seller_id from categories");
  });

  it("keeps Clothing where the gendered pair used to sit", () => {
    // Not appended at the end of the list: the shop ordered its own
    // categories and this is not the file that reorders them.
    expect(MIGRATION).toContain("select min(sort_order) from categories");
  });
});

describe("the migration is deployed the way every other one is", () => {
  it("runs after the seed whose tree it reshapes", () => {
    const seed = SCHEMA_ORDER.indexOf("taxonomy-seed.sql");
    const mine = SCHEMA_ORDER.indexOf("clothing-taxonomy.sql");
    expect(seed).toBeGreaterThan(-1);
    expect(mine).toBeGreaterThan(seed);
  });

  it("runs after the file that adds the column it updates", () => {
    // purchase_order_items.catalog_category_id comes from po-taxonomy.sql.
    expect(SCHEMA_ORDER.indexOf("clothing-taxonomy.sql"))
      .toBeGreaterThan(SCHEMA_ORDER.indexOf("po-taxonomy.sql"));
  });

  it("is exempt from the health panel, being data rather than schema", () => {
    // It creates no table, column, view or function, so there is nothing
    // the panel could probe that schema.sql has not already made.
    expect(NOT_SCHEMA_FILES).toContain("clothing-taxonomy.sql");
  });

  it("is in run-all.sql, which is what an operator actually runs", () => {
    expect(read("supabase/run-all.sql")).toContain("-- ==== clothing-taxonomy.sql");
  });
});
