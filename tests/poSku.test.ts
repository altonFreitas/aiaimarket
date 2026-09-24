import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const FORM = read("src/components/admin/procurement/PurchaseOrderForm.tsx");
const RECEIVE = read("src/lib/receiving.ts");

/* ONE LINE, ONE SKU.
 *
 * A purchase order line used to be one PRODUCT with a "S, M, L, XL" box
 * and a grid of quantities under it. That shape could say how many of each
 * size were bought and could not say what each one cost, because the line
 * carried a single unit price and a single selling price for the lot.
 *
 * What the change has to get right is everything DOWNSTREAM of it, which
 * is what these check: three lines for one shirt must not become three
 * shirts in the shop.
 */

describe("what the line stopped asking", () => {
  it("has no sizes box, no per-size grid and no bulk generator", () => {
    for (const gone of ["sizesVariants", "qtyPerSize", "po-size-grid", "sizeQty",
                        "sizesForLine", "lineUnits", "bulkGenerate", "variantValueSets",
                        "po-bulk"]) {
      expect(FORM, gone).not.toContain(gone);
    }
  });

  it("names the two prices for what they are", () => {
    expect(FORM).toContain('t("costPrice", lang)');
    expect(FORM).toContain('t("sellingPrice", lang)');
  });
});

describe("a header, and the rows it is true of", () => {
  /* It was one line per SKU, which made the money right and made the
     screen repeat itself: twelve rows each carrying the product's name,
     its category, its description and its type, identical every time,
     with one size box telling them apart. */
  it("asks for the product, its category and its type once", () => {
    for (const once of ['id={`n${i}`}', 'id={`c${i}`}', 'id={`cc${i}`}',
                        'id={`ds${i}`}', "<TaxonomyPicker"]) {
      expect(FORM.split(once).length - 1, once).toBe(1);
    }
  });

  it("asks for the quantity, both prices and the audience per ROW", () => {
    /* All four differ between a 38 and a 45 of the same shoe, which is the
       whole reason a line is not a product any more. */
    for (const perRow of ["`${r.key}-q`", "`${r.key}-u`", "`${r.key}-sp`", "`${r.key}-au`"]) {
      /* Twice each: the label's htmlFor and the control's id. Asserting it
         is merely PRESENT passed with half of a rename applied, which is
         the state where the label points at nothing. */
      expect(FORM.split(perRow).length - 1, perRow).toBe(2);
    }
    expect(FORM).toContain("l.rows.map((r, ri) => (");
  });

  it("draws each row's own axes, and only the axes", () => {
    expect(FORM).toContain("{axesOf(l).map((a) => (");
    expect(FORM).toContain("value={r.values[a.id] ?? []}");
    // The header's picker draws the type and nothing under it.
    expect(FORM).toContain('fields="none"');
  });

  it("gives every row its own ids", () => {
    // Two rows of one product type draw the same attributes twice, and two
    // boxes with one id means both labels point at the first.
    expect(FORM).toContain("idPrefix={`${r.key}-`}");
  });

  it("totals a line from its rows", () => {
    expect(FORM).toContain("(a, r) => a + (Number(r.qty) || 0) * (Number(r.unitPrice) || 0), 0)");
    expect(FORM).toContain("lines.reduce((a, l) => a + lineTotal(l), 0)");
  });
});

describe("one more of the same thing, in another colour", () => {
  it("adds a ROW, not a line", () => {
    expect(FORM).toContain("onClick={() => addRow(i)}");
    expect(FORM).toContain("rows: [...l.rows, { ...from, key: nextKey(), values: {} }]");
  });

  it("copies the numbers and clears the combination", () => {
    /* The second colour is usually bought in the same numbers at the same
       cost; correcting three boxes beats typing six. The combination is
       the one thing the new row exists to change. */
    expect(FORM).toContain("const from = lines[i].rows.at(-1) ?? blankRow();");
  });

  it("does not touch the header", () => {
    // That is the point of the split: the name, the category, the type and
    // the description are said once.
    const fn = FORM.slice(FORM.indexOf("function addRow("),
                          FORM.indexOf("function removeRow("));
    for (const header of ["productName", "catalogCategoryId", "productTypeId", "description"]) {
      expect(fn, header).not.toContain(header);
    }
  });

  it("is offered once a product type is chosen", () => {
    // Nothing to repeat before that: the row has no questions yet.
    expect(FORM).toContain('l.category === "goods_for_resale" && !l.productId && l.productTypeId && (');
  });
});

describe("what is written, and what is read back", () => {
  it("writes one purchase order item per row, carrying the header", () => {
    /* purchase_order_items stays flat -- one row per SKU -- because that
       is what the ledger, the receipt and the variants all read. */
    expect(FORM).toContain("lines.flatMap((l) => l.rows.map((r) => ({");
    expect(FORM).toContain("qty: Number(r.qty), unitPrice: Number(r.unitPrice),");
    expect(FORM).toContain("productTypeId: l.productTypeId || null,");
    expect(FORM).toContain("attributeValues: r.values,");
  });

  it("puts the rows back under their header when the order is reopened", () => {
    expect(FORM).toContain("po?.items?.length ? groupItems(po.items)");
    expect(FORM).toContain("if (last && last.headerKey === headerOf(i))");
  });

  it("groups on everything the header holds, and only consecutively", () => {
    /* Two rows that agree on all of it ARE one line; two that differ on
       any of it are two products. Consecutive, because the order they were
       written in is the order the buyer typed them in. */
    const fn = FORM.slice(FORM.indexOf("const headerOf ="), FORM.indexOf("for (const i of items)"));
    for (const part of ["i.product_name", "i.category", "i.product_id",
                        "i.catalog_category_id", "i.product_type_id", "i.description"]) {
      expect(fn, part).toContain(part);
    }
    expect(FORM).toContain("out.at(-1)");
  });

  it("clears the rows' answers when the goods are refiled", () => {
    // They answered questions the new branch never asks.
    expect(FORM).toContain("rows: l.rows.map((r) => ({ ...r, values: {} })),");
  });
});

describe("the keys the lines are drawn with", () => {
  it("does not count in a module-level variable", () => {
    /* FOUND IN A BROWSER, ON THE CONSOLE. A module counter keeps climbing
       for as long as the server process lives, so the server rendered a
       line keyed l7 and the browser rendered the same line keyed l1 --
       and the key is the prefix on every id the line draws, so React threw
       a hydration mismatch over id="l7-attr-…" versus id="l1-attr-…". */
    expect(FORM).not.toMatch(/^let keySeq/m);
    expect(FORM).not.toContain("++keySeq");
  });

  it("keys the lines it opens with by position", () => {
    /* The same on the server and in the browser, which is the point: the
       key is the prefix on every id the line draws. groupItems numbers
       headers and rows from one counter as it walks the saved items, and
       that walk is the same walk in both documents. */
    expect(FORM).toContain("let n = 0;");
    expect(FORM).toContain("key: `i${n++}`");
    expect(FORM.split("key: `i${n++}`").length - 1, "header and row").toBe(2);
  });

  it("keys the rest from a counter, under a prefix that cannot collide", () => {
    expect(FORM).toContain('const nextKey = () => `n${++seq.current}`');
  });

  it("gives React a stable key rather than the index", () => {
    // Deleting the middle of three lines reconciles line 3 onto line 2's
    // DOM, so the picker under it keeps the deleted line's attributes.
    expect(FORM).toContain('<div key={l.key} className="po-line">');
    expect(FORM).not.toContain('<div key={i} className="po-line">');
  });
});

describe("three lines for one shirt are not three shirts", () => {
  it("reuses a product this receipt already created", () => {
    /* Each line creating its own product would put three "Blue Shirt"
       listings in the shop, each holding a third of the stock, each with
       its own slug -- and the shopper would find all three. */
    expect(RECEIVE).toContain("const createdHere = new Map<string, string>()");
    expect(RECEIVE).toContain(
      "let productId = item.product_id || createdHere.get(productKey(item.product_name)) || null;");
    expect(RECEIVE).toContain("createdHere.set(productKey(item.product_name), productId);");
  });

  it("matches on the name the buyer typed, folded", () => {
    expect(RECEIVE).toMatch(
      /const productKey = \(name: string\) =>\s*\n\s*String\(name \|\| ""\)\.trim\(\)\.toLowerCase\(\)\.replace\(\/\\s\+\/g, " "\);/);
  });

  it("makes each line a variant carrying its own selling price", () => {
    expect(RECEIVE).toContain("const lineVariant = await ensureVariant(");
    expect(RECEIVE).toContain("price: item.sell_price == null ? null : Number(item.sell_price)");
    expect(RECEIVE).toContain('.from("variant_attribute_values").insert(');
  });

  it("tops up a variant that already exists rather than making a second", () => {
    // product_variants is unique on (product_id, label): a restock has to
    // find the row, and it must not reprice it either.
    expect(RECEIVE).toMatch(
      /\.from\("product_variants"\)\.select\("id"\)\s*\n\s*\.eq\("product_id", productId\)\.eq\("label", label\)\.maybeSingle\(\);\s*\n\s*if \(found\) return/);
  });

  it("moves the stock against that variant, with its size", () => {
    /* The ledger has carried a size column since size-stock.sql and the
       per-size views read it; a variant receipt that left it empty would
       move the stock into the "no size recorded" pool, which backs every
       size. */
    expect(RECEIVE).toContain("const variantQty = lineVariant\n      ? { [lineVariant.id]: units }");
    expect(RECEIVE).toContain("if (lineVariant) sizeByVariant.set(lineVariant.id, lineVariant.size);");
  });

  it("still honours the old shape", () => {
    // An order placed before a line was one SKU buys several variants at
    // once, and its goods still have to land.
    expect(RECEIVE).toContain(": normalizeVariantQty(item.variant_qty);");
  });

  it("keeps the product's spec free of the variant axes", () => {
    /* The line says Size S; the product is S, M and L. Writing "Size: S"
       onto the product prints exactly that in the Specifications panel of
       a shirt sold in three sizes. */
    expect(RECEIVE).toContain("const shared = attrs.filter((a) => !a.is_variant);");
  });

  it("grows the product's size list from what the lines actually bought", () => {
    // The storefront's size picker draws from products.sizes, and the box
    // that used to fill it in is gone.
    expect(RECEIVE).toContain("if (lineVariant?.size) await addSize(productId, lineVariant.size);");
  });

  it("never lets the card quote more than the cheapest variant", () => {
    /* The card shows the PRODUCT's price. Taking the first line's would
       let a shopper click a $45 card and find every size costs more. */
    expect(RECEIVE).toContain("await lowerPriceTo(productId, Number(item.sell_price));");
    expect(RECEIVE).toContain("if (now > 0 && now <= price) return;");
  });

  it("does not reprice a listing the shop has since set", () => {
    // Only for a product this receipt created a moment ago.
    expect(RECEIVE).toContain(
      "if (lineVariant && createdHere.get(productKey(item.product_name)) === productId");
  });
});
