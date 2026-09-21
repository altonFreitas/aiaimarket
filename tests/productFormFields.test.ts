import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const FORM = read("src/components/admin/ProductForm.tsx");
const PICKER = read("src/components/admin/TaxonomyPicker.tsx");
const PAGE = read("src/app/admin/p/[id]/page.tsx");
const CSS = read("src/app/globals.css");

/* WHAT /admin/p/new ASKS, AND WHAT IT STOPPED ASKING.
 *
 * The form grew two Category dropdowns: the one that has always written
 * products.category_id, and a second drawn by the taxonomy picker over the
 * same rows of the same table. Nothing on the screen said which of the two
 * the shop menu would use, and answering them differently filed a product
 * in one place and typed it from another.
 *
 * These are source assertions rather than a rendered test, which is the
 * pattern this project already uses for the admin forms -- they are server
 * components behind a session. Each one names the bug it would catch.
 */

describe("one category question, asked once", () => {
  it("has exactly one Category control and one Subcategory control", () => {
    expect(FORM.match(/<select id="category_id"/g) ?? []).toHaveLength(1);
    expect(FORM.match(/<select id="subcategory_id"/g) ?? []).toHaveLength(1);
    // And the picker contributes none of its own.
    expect(PICKER).not.toMatch(/<select id="tx-(cat|sub)"/);
  });

  it("feeds the picker the category the form settled on", () => {
    // Not a second question asked of the same person: the node IS
    // f.category_id, which is the leaf the two dropdowns produce.
    expect(FORM).toContain("node={f.category_id}");
  });

  it("clears the product type when the product is refiled", () => {
    /* Types hang off a node. A product moved to another category is no
       longer the type it was, and saving would otherwise write a type from
       the old branch plus answers to questions the new one never asked. */
    expect(FORM).toMatch(
      /function refile\(categoryId: string\) \{[\s\S]*?setTax\(\{ productTypeId: "", values: \{\} \}\)/);
    // Both dropdowns go through it. Either one bypassing it is the bug.
    expect(FORM.match(/refile\(/g) ?? []).toHaveLength(3);
    expect(FORM).not.toMatch(/onChange=\{\(e\) => set\("category_id"/);
  });

  it("opens an existing product where it is filed, not where its type lives", () => {
    /* /admin/migrate types a Tetum category's products with an English
       product type from another branch. Seeding the pair from the type's
       node would silently move the product to that branch on the next
       save -- off the category page the shop has been linking to. */
    expect(PAGE).not.toContain("parent_id ?? n.id");
    expect(FORM).toContain('category_id: product?.category_id');
  });

  it("defaults a new product to a ROOT category", () => {
    // cats is every category in sort order, so cats[0] could perfectly
    // well be a subcategory -- and the Category dropdown, which only
    // lists roots, would then render blank on a brand new product.
    expect(FORM).toContain(
      'category_id: product?.category_id || cats.find((c) => !c.parent_id)?.id || ""');
  });
});

describe("the boxes that went", () => {
  it("no longer offers to create a category from one typed word", () => {
    for (const marker of ['id="newcat"', 'id="newsubcat"', "onCreateCategory", "createCategory"]) {
      expect(FORM, marker).not.toContain(marker);
    }
  });

  it("no longer asks for sizes or tags", () => {
    expect(FORM).not.toContain('t("sizesLabel", lang)');
    expect(FORM).not.toContain('t("utility", lang)');
  });

  it("still writes back the sizes and tags it was given", () => {
    /* THE COLUMNS DID NOT GO. saveProduct writes both on every save, so
       dropping the keys would blank a product's sizes the first time
       anybody edited its price -- taking the size picker off the
       storefront and the size breakdown off every restock of it. */
    expect(FORM).toContain("const keptSizes = product?.sizes || []");
    expect(FORM).toContain("const keptTags = product?.tags || []");
    expect(FORM).toContain("sizes: keptSizes");
    expect(FORM).toContain("tags: keptTags");
  });
});

describe("an explanation is smaller than the thing it explains", () => {
  it("sizes .hint once, rather than per context", () => {
    /* A bare <p className="hint"> outside a .field used to inherit body
       size, so the paragraph under "Where this product belongs" was set
       larger than the labels of the boxes it described. */
    expect(CSS).toMatch(/\n\.hint\{font-size:var\(--fs-sm\);color:var\(--muted\)\}/);
  });

  it("keeps the smaller size for a hint under a single box", () => {
    expect(CSS).toMatch(/\.field \.hint\{font-size:var\(--fs-caption\)/);
  });

  it("leaves no copy of the base rule behind to drift from it", () => {
    // Each of these used to restate font-size:var(--fs-sm) for itself.
    for (const sel of [".invite-row .hint", ".notif-head .hint", ".access-quick .hint",
                       ".page-head > .hint"]) {
      const rule = CSS.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{[^}]*\\}"));
      expect(rule, sel).not.toBeNull();
      expect(rule![0], sel).not.toContain("font-size");
    }
  });
});
