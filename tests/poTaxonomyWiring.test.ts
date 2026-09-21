import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const FORM = read("src/components/admin/procurement/PurchaseOrderForm.tsx");
const SAVE = read("src/lib/purchasing.ts");
const RECEIVE = read("src/lib/receiving.ts");
const MIGRATION = read("supabase/po-taxonomy.sql");
const FIELD = read("src/components/admin/AttributeField.tsx");

/* BUYING A PRODUCT TYPE, AND RECEIVING A COMPLETE LISTING.
 *
 * The rules here are about wiring between files, which is where this
 * feature can break without any one file looking wrong. Each assertion
 * names the failure it would catch.
 */

describe("the line asks the same questions the product form asks", () => {
  it("draws the shared picker rather than a second copy of it", () => {
    expect(FORM).toContain("<TaxonomyPicker");
    expect(FORM).toContain("node={l.catalogCategoryId}");
  });

  it("gives each line its own ids", () => {
    /* An order restocking two shirts of one product type draws every
       attribute twice. Without a prefix both carry id="attr-<uuid>", and
       every label, every aria-describedby and every click resolves to the
       first -- so the second line's error is announced against the first
       line's box. */
    expect(FORM).toContain("idPrefix={`l${i}-`}");
    expect(FIELD).toContain("const id = `${idPrefix}attr-${attr.id}`");
  });

  it("offers the shop category as root and subcategory, not one flat list", () => {
    expect(FORM).toContain("rootCats.map");
    expect(FORM).toContain("subCatsOf(l.catalogCategoryId)");
    expect(FORM).not.toMatch(/categories\.map\(\(c\) => <option/);
  });

  it("clears a line's product type when its goods are refiled", () => {
    /* Types hang off a node. Carrying one across a move would save a type
       from the old branch and answers to questions the new one never
       asked. */
    expect(FORM).toMatch(
      /function refile\(i: number, categoryId: string\)[\s\S]*?taxonomy: categoryId === l\.catalogCategoryId\s*\n?\s*\? l\.taxonomy : \{ productTypeId: "", values: \{\} \}/);
  });
});

describe("the line stays a row", () => {
  it("puts no note under a box that shares the row", () => {
    /* MEASURED IN A BROWSER, AND BROKEN TWICE BY THIS VERY CHANGE. The
       fields on a line are bottom-aligned so that a label wrapping onto
       two lines still leaves the boxes level. A <p className="hint"> inside
       one of them makes that field taller and lifts its box above every
       other box in the row -- which is what the half-size note under
       "Size / variant" did, and then what the restock note inside the
       "Linked product" field did: the pill ended up 36 pixels clear of
       everything beside it.

       A note belongs in a field that is a row of its own. Each hint in the
       line is therefore traced back to the field that contains it, and
       that field has to be one of the full-width ones. */
    const FULL_WIDTH = ["po-sizes", "po-line-desc", "po-line-note", "po-line-tax"];
    const line = FORM.slice(FORM.indexOf('className="po-line"'),
                            FORM.indexOf('className="po-line-total"'));
    const hints = [...line.matchAll(/className="hint"/g)].map((m) => m.index!);
    expect(hints.length).toBeGreaterThan(0);
    for (const at of hints) {
      const fieldAt = line.lastIndexOf('className="field', at);
      expect(fieldAt, "a hint outside any field").toBeGreaterThan(-1);
      const classes = line.slice(fieldAt + 'className="'.length,
                                 line.indexOf('"', fieldAt + 'className="'.length));
      expect(FULL_WIDTH.some((c) => classes.includes(c)), `hint inside .${classes}`).toBe(true);
    }
  });
});

describe("the server believes the database, not the browser", () => {
  it("reads each line's attributes FROM the product type", () => {
    // Section 25. The payload names ids; only the type says which are real.
    expect(SAVE).toContain('await sb.from("product_types").select("id").eq("id", id).maybeSingle()');
    expect(SAVE).toContain("attributesForType(id, { includeAdminOnly: true })");
    expect(SAVE).toContain("checkLineTaxonomy(");
  });

  it("treats a type it cannot find as a refusal, not as an empty list", () => {
    /* attrsByType.get() returning undefined for a type nobody looked up
       would become `?? null`, which checkLineTaxonomy refuses -- and a
       real type with no attributes yet is a separate, allowed case. */
    /* Asserted as the whole expression. ": null);" on its own also
       matches half a dozen other ternaries in this file, so the check
       passed with the branch inverted. */
    expect(SAVE).toContain(
      "attrsByType.set(id, data\n        ? await attributesForType(id, { includeAdminOnly: true })\n        : null);");
  });

  it("does not stop a shop saving orders before the SQL is pasted", () => {
    /* This project deploys code and runs SQL by hand afterwards, and
       Postgres fails the whole statement over one unknown column. Without
       this, pulling the code would stop every purchase order saving. */
    expect(SAVE).toContain("writeTolerating(");
    expect(SAVE).toContain('{ product_type_id: null, attribute_values: {} }');
    expect(SAVE).toContain('"product_type_id" in extra');
    expect(SAVE).toContain('"attribute_values" in extra');
  });
});

describe("what receiving does with it", () => {
  it("gives a product it CREATES the type and the answers", () => {
    /* Anchored to the creation branch. The bare call also appears inside
       fillBlankTaxonomy, so matching it alone passed with the creation
       one deleted. */
    expect(RECEIVE).toContain(
      "result.productsCreated++;\n\n      // What kind of thing it is, and what it answers. Only for a product\n      // this receipt CREATED -- see applyTaxonomy.\n      await applyTaxonomy(productId, item);");
    expect(RECEIVE).toContain('.update({ product_type_id: typeId })');
    expect(RECEIVE).toContain('.from("product_attribute_values").insert(');
  });

  it("validates them again against the type", () => {
    /* Months pass between an order and a delivery, and an attribute can be
       retired from a product type in between. Re-reading the type is what
       stops a stale answer becoming a row nothing can explain. */
    expect(RECEIVE).toContain("attributesForType(typeId, { includeAdminOnly: true })");
    expect(RECEIVE).toContain("validateAttributeValues(attrs, submittedFrom(item.attribute_values))");
  });

  it("FILLS a blank type on an existing product and never replaces one", () => {
    /* The most destructive thing a restock could do: changing a product's
       type changes which questions exist, and saveProductAttributes
       deletes the answers to the old ones. A shirt restocked from a
       supplier who files it differently would come back from the delivery
       with its whole specification gone. */
    expect(RECEIVE).toContain("if (item.product_id && productId) await fillBlankTaxonomy(productId, item);");
    expect(RECEIVE).toMatch(
      /async function fillBlankTaxonomy[\s\S]*?if \(\(data as \{ product_type_id\?: string \| null \}\)\.product_type_id\) return;/);
  });

  it("never fails a delivery over a specification", () => {
    // The goods are on the shelf. A listing to finish is not a delivery to
    // reject.
    const body = RECEIVE.slice(RECEIVE.indexOf("async function applyTaxonomy"));
    expect(body).toContain("} catch {");
  });
});

describe("the migration", () => {
  it("does not delete purchase orders when a product type is retired", () => {
    expect(MIGRATION).toContain("on delete set null");
    expect(MIGRATION).not.toMatch(/on delete cascade/i);
  });

  it("defaults the answers to an empty object rather than null", () => {
    // So an old line and a new one take one code path at receipt.
    expect(MIGRATION).toContain("attribute_values jsonb not null default '{}'::jsonb");
  });

  it("survives a database with no taxonomy tables", () => {
    // The foreign key cannot be created against a table that is not there,
    // and an unguarded ALTER would fail the whole file.
    expect(MIGRATION).toContain("if to_regclass('public.product_types') is not null then");
  });
});
