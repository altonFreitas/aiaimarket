import { describe, it, expect } from "vitest";
import {
  normalizeName, matchProductType, groupForMigration, type TypeCandidate,
} from "@/lib/taxonomy/migrate";

const T = (id: string, name: string, path = "Cat / Sub"): TypeCandidate =>
  ({ id, name, path });

const TYPES = [
  T("t1", "Sofas"), T("t2", "Running Shoes"), T("t3", "Smartphones"),
  T("t4", "Chairs", "Home / Furniture"), T("t5", "Chairs", "Office / Seating"),
];

describe("normalizing a name", () => {
  it("ignores case, accents and a trailing plural", () => {
    expect(normalizeName("Sofas")).toBe(normalizeName("sofa"));
    expect(normalizeName("Telemóvel")).toBe("telemovel");
    expect(normalizeName("  RUNNING   SHOES  ")).toBe("running shoe");
  });

  it("does not collapse genuinely different names", () => {
    // "Sofa beds" is not "Sofas".
    expect(normalizeName("Sofa beds")).not.toBe(normalizeName("Sofas"));
    expect(normalizeName("Dining Tables")).not.toBe(normalizeName("Coffee Tables"));
  });
});

describe("matching, which never guesses", () => {
  it("matches an exact name", () => {
    const r = matchProductType("Sofas", TYPES);
    expect(r.typeId).toBe("t1");
    expect(r.reason).toBe("matched");
  });

  it("matches across a plural and a capital", () => {
    expect(matchProductType("sofa", TYPES).typeId).toBe("t1");
    expect(matchProductType("RUNNING SHOES", TYPES).typeId).toBe("t2");
  });

  it("refuses a near miss rather than taking it", () => {
    /* A product filed under the wrong type gets the wrong questions, the
       wrong filters and the wrong specification table, and the shop finds
       out when a customer asks why a shoe has a Seat Height. Unmapped is
       visibly unfinished; wrongly mapped looks finished and is not. */
    for (const near of ["Shoes", "Sofa bed", "Phone", "Smart phone"]) {
      const r = matchProductType(near, TYPES);
      expect(r.typeId, near).toBeNull();
      expect(r.reason, near).toBe("none");
    }
  });

  it("refuses when two product types share the name", () => {
    // "Chairs" exists under Furniture and under Office. Both are real.
    const r = matchProductType("Chairs", TYPES);
    expect(r.typeId).toBeNull();
    expect(r.reason).toBe("ambiguous");
    expect(r.candidates.map((c) => c.path).sort())
      .toEqual(["Home / Furniture", "Office / Seating"]);
  });

  it("returns nothing for an empty or punctuation-only name", () => {
    for (const junk of ["", "   ", "---"]) {
      expect(matchProductType(junk, TYPES).typeId).toBeNull();
    }
  });

  it("finds nothing for a catalogue in another language, and says so", () => {
    /* THE HONEST CASE, and the reason the admin screen is the main road.
       A real shop here trades in Tetum: Sapatu, Roupa, Telemóvel. The
       seeded taxonomy is English. Almost nothing matches, and a migration
       that pretended otherwise would quietly do nothing while somebody
       believed the job was done. */
    for (const tetum of ["Sapatu", "Roupa", "Telemóvel & asesóriu"]) {
      const r = matchProductType(tetum, TYPES);
      expect(r.typeId, tetum).toBeNull();
      expect(r.reason, tetum).toBe("none");
    }
  });
});

describe("grouping the work by category", () => {
  const CATS = [
    { id: "c1", name: "Sapatu" }, { id: "c2", name: "Sofas" },
  ];
  const products = [
    { id: "p1", category_id: "c1" },
    { id: "p2", category_id: "c1" },
    { id: "p3", category_id: "c1" },
    { id: "p4", category_id: "c2" },
    { id: "p5", category_id: "c2", product_type_id: "t1" },   // already done
    { id: "p6", category_id: null },                           // no category
  ];

  it("counts only what is still pending", () => {
    const g = groupForMigration(products, CATS, TYPES);
    const sapatu = g.find((x) => x.categoryId === "c1")!;
    const sofas = g.find((x) => x.categoryId === "c2")!;
    expect(sapatu.pending).toBe(3);
    expect(sofas.pending).toBe(1);     // p5 is done and does not count
  });

  it("puts the biggest group first, because it is worth the most", () => {
    const g = groupForMigration(products, CATS, TYPES);
    expect(g[0].categoryId).toBe("c1");
    expect(g[0].pending).toBe(3);
  });

  it("carries a suggestion only where one is certain", () => {
    const g = groupForMigration(products, CATS, TYPES);
    expect(g.find((x) => x.categoryId === "c2")!.suggestion.typeId).toBe("t1");
    expect(g.find((x) => x.categoryId === "c1")!.suggestion.typeId).toBeNull();
  });

  it("offers products with no category at all", () => {
    // Otherwise they could never be migrated, and would sit unfinished
    // forever with nothing on any screen explaining why.
    const g = groupForMigration(products, CATS, TYPES);
    const none = g.find((x) => x.categoryId === "");
    expect(none).toBeDefined();
    expect(none!.pending).toBe(1);
    expect(none!.categoryName).toBe("(no category)");
  });

  it("returns nothing when every product is already migrated", () => {
    const done = products.map((p) => ({ ...p, product_type_id: "t1" }));
    expect(groupForMigration(done, CATS, TYPES)).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ *
 * The screen and the action, as source
 * ------------------------------------------------------------------------ */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const ACTION = fs.readFileSync(path.join(ROOT, "src/lib/actions/migrate.ts"), "utf8");
const SCREEN = fs.readFileSync(
  path.join(ROOT, "src/components/admin/MigrateAdmin.tsx"), "utf8");

describe("what filing a category must never do", () => {
  it("touches only products that have no type yet", () => {
    /* Somebody may have set one by hand, or set it to something better
       than the category-wide answer. A bulk action that overwrote that
       would destroy the careful work in favour of the quick work. */
    expect(ACTION).toContain('.is("product_type_id", null)');
  });

  it("changes nothing else about the product", () => {
    // Not price, stock, images, sizes or status: a product selling before
    // is selling after, with an empty specification table until somebody
    // fills it in.
    // The update call itself, which ends at the .is() that narrows it.
    const from = ACTION.indexOf(".update({");
    const update = ACTION.slice(from, ACTION.indexOf(".is(", from));
    expect(update).toContain("product_type_id: productTypeId");
    for (const field of ["price", "qty", "status", "images", "archived", "sizes"]) {
      expect(update, `update must not touch ${field}`).not.toContain(field);
    }
  });

  it("checks the product type against the database, not the form", () => {
    /* Section 25. An id naming something real but unrelated is what a
       crafted request sends, and filing two hundred products under it
       would be a large, quiet mess to undo. */
    const check = ACTION.indexOf('.from("product_types")');
    const write = ACTION.indexOf('.from("products")');
    expect(check).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(check);
  });

  it("offers no second way to file a single product", () => {
    // The product's own edit page sets its type and its attributes
    // together. A second path is a second thing to keep right.
    expect(ACTION).not.toContain("migrateProduct");
    expect(SCREEN).not.toContain("migrateProduct");
  });
});

describe("what the screen has to admit", () => {
  it("says why the suggestions are mostly blank", () => {
    /* The honest finding: a shop's categories are in the language it
       trades in and the taxonomy is in English, so name matching finds
       almost nothing. A screen that showed empty boxes without saying so
       would look broken. */
    expect(SCREEN).toMatch(/Tetum/);
    expect(SCREEN).toMatch(/blank/i);
  });

  it("says the products are still selling", () => {
    // The sentence wraps in the source, so the space is any whitespace.
    expect(SCREEN).toMatch(/selling\s+normally/i);
  });
});
