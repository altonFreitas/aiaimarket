import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const FORM = read("src/components/admin/procurement/PurchaseOrderForm.tsx");
const RECEIVE = read("src/lib/receiving.ts");
const CSS = read("src/app/globals.css");
const PICKER = read("src/components/admin/TaxonomyPicker.tsx");
const PRODUCT_FORM = read("src/components/admin/ProductForm.tsx");

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
  it("has no sizes box and no per-size grid", () => {
    for (const gone of ["sizesVariants", "qtyPerSize", "po-size-grid",
                        "sizeQty", "sizesForLine", "lineUnits"]) {
      expect(FORM, gone).not.toContain(gone);
    }
  });

  it("types the quantity rather than deriving it from a grid", () => {
    // It was read-only whenever a grid existed. There is no grid: the line
    // IS the grid row.
    expect(FORM).not.toMatch(/readOnly=\{sizesForLine/);
    expect(FORM).toMatch(/id=\{`q\$\{i\}`\}[\s\S]{0,120}value=\{l\.qty\}/);
  });

  it("names the two prices for what they are", () => {
    expect(FORM).toContain('t("costPrice", lang)');
    expect(FORM).toContain('t("sellingPrice", lang)');
  });

  it("totals the line from its own quantity and cost", () => {
    expect(FORM).toContain("((Number(l.qty) || 0) * (Number(l.unitPrice) || 0)).toFixed(2)");
    expect(FORM).toContain("(a, l) => a + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0)");
  });
});

describe("splitting one line into many", () => {
  it("expands through the shared, tested matrix", () => {
    expect(FORM).toContain("variantValueSets(line.taxonomy.values, axes)");
  });

  it("splits on the product type's own axes, not on a size box", () => {
    // Nothing here knows what a size is: an axis is an attribute the
    // catalogue marked is_variant.
    expect(FORM).toContain("(lineAttrs[l.key] ?? []).filter((a) => a.is_variant)");
  });

  it("hands the new lines the attributes they inherited", () => {
    /* Same product type, same questions. Without it each generated line
       fetches the identical attribute list again and its heading stays
       blank until the answer comes back. */
    expect(FORM).toContain("...Object.fromEntries(made.map((v) => [v.key, m[line.key] ?? []]))");
  });

  it("heads each line with the combination it buys", () => {
    /* MEASURED. Six generated rows read "Blue Shirt, 10, 4.00, 12.00" and
       nothing else -- identical, with the size buried in an attribute grid
       at the bottom of each. */
    expect(FORM).toContain("const skuOf = (l: LineDraft)");
    expect(FORM).toContain('.join(" / ")');
    expect(FORM).toContain('className="field po-line-sku"');
    expect(CSS).toMatch(/\.po-line \.field\.po-line-sku\{flex:1 1 100%/);
  });
});

describe("each question is asked once, not once per line", () => {
  it("draws only the axes on a line", () => {
    /* A t-shirt's product type asks fourteen questions. Eleven of them --
       Brand, Fit, Pattern, Season, Neck Type -- describe the PRODUCT, and
       a twelve-SKU order asked all fourteen twelve times and got the same
       eleven answers every time. */
    expect(FORM).toContain('fields={bulk[l.key] ? "none" : "variant"}');
    expect(PICKER).toContain('fields === "variant" ? forThisType.filter((a) => a.is_variant)');
  });

  it("draws none of them while the split is being set up", () => {
    /* The generator asks for a LIST of sizes. Its boxes beside the line's
       own single-size boxes are two Size fields on one screen meaning
       different things, which is what made this look duplicated. */
    expect(PICKER).toContain('fields === "none" ? []');
  });

  it("still tells the truth about a type with no fields at all", () => {
    // The notice has to answer for the TYPE, not for the subset asked
    // for, or a line showing axes only would claim the type is empty.
    expect(PICKER).toMatch(/fields !== "none" && value\.productTypeId\s*\n\s*&& forThisType\.length === 0/);
  });

  it("leaves the product form asking everything", () => {
    // Default, so the one screen where a product is described in full is
    // unchanged.
    expect(PICKER).toContain('fields = "all"');
    expect(PRODUCT_FORM).not.toContain("fields=");
  });
});

describe("one more of the same thing, in another colour", () => {
  it("offers it once a product type is chosen", () => {
    // Nothing to copy before that: the line is not yet a SKU.
    expect(FORM).toMatch(/\{l\.taxonomy\.productTypeId && \(\s*\n\s*<WriteOnly>\s*\n\s*<div className="field po-line-more">/);
    expect(FORM).toContain('onClick={() => addLineLike(i)}');
  });

  it("copies what describes the goods and blanks what identifies the SKU", () => {
    /* MEASURED: one line became two carrying "Blue Shirt", 10 and the
       description. The combination is the one thing this line exists to
       change. */
    expect(FORM).toContain("const axes = new Set(axesOf(line).map((a) => a.id));");
    expect(FORM).toContain(
      "Object.entries(line.taxonomy.values).filter(([id]) => !axes.has(id))");
  });

  it("never copies the link to a catalogue product", () => {
    /* A line pointing at an existing product is a restock of exactly that
       product; copying it would top the same one up twice from one order. */
    expect(FORM).toContain('{ ...line, key, productId: "", taxonomy: { ...line.taxonomy, values } }');
  });

  it("puts the new line directly under the one it came from", () => {
    // Not at the bottom of a twelve-line order, where nobody would find it.
    expect(FORM).toContain("...ls.slice(0, i + 1),");
  });

  it("hands it the attributes rather than making it fetch them again", () => {
    expect(FORM).toContain("setLineAttrs((m) => ({ ...m, [key]: m[line.key] ?? [] }));");
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
    // The same on the server and in the browser, which is the point.
    expect(FORM).toMatch(/po\.items\.map\(\(i, n\) => \(\{\s*\n\s*key: `i\$\{n\}`/);
    expect(FORM).toContain('.map((l, n) => ({ ...l, key: `i${n}` }))');
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
