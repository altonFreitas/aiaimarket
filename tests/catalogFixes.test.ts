import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { describeColor } from "@/lib/colorName";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const FORM = read("src/components/admin/ProductForm.tsx");
const ATTRS = read("src/lib/actions/product-attributes.ts");
const EDITOR = read("src/components/admin/VariantEditor.tsx");
const PICKER = read("src/components/admin/TaxonomyPicker.tsx");
const SELLER = read("src/components/seller/SellerProcurement.tsx");
const CSS = read("src/app/globals.css");

describe("one Save, one product", () => {
  /* THE BUG: creating a product listed two. Saving a NEW product writes
     the product first and its answers second -- it has to, the answers
     need an id -- and if the answers are refused the form stays put so the
     fields needing attention are on screen. The id it had just created was
     a local const, thrown away. The second press saved with no id again
     and inserted a second row: one product carrying the answers and one
     carrying none. */
  it("remembers what it created", () => {
    expect(FORM).toContain("const [savedProductId, setSavedProductId] = useState(product?.id ?? \"\");");
    expect(FORM).toContain("id: savedProductId || undefined,");
  });

  it("remembers it before anything downstream can fail", () => {
    const body = FORM.slice(FORM.indexOf("const savedId = await saveProduct("));
    const remembered = body.indexOf("setSavedProductId(savedId)");
    const attributes = body.indexOf("saveProductAttributes({");
    expect(remembered).toBeGreaterThan(-1);
    expect(remembered, "remembered before the answers are written")
      .toBeLessThan(attributes);
  });

  it("no longer reads the id straight from the prop", () => {
    expect(FORM).not.toContain("id: product?.id,");
  });
});

describe("the size answer and the size picker are one fact", () => {
  /* They were two: the answer went to product_attribute_values, which the
     Details block reads, and the picker reads products.sizes, which this
     form stopped writing. A shirt whose Size said "M, L, XL" offered the
     shopper a dash. */
  it("copies the answer into the column the picker reads", () => {
    expect(ATTRS).toContain("await syncSizes(sb, productId, attrs, result.rows);");
    expect(ATTRS).toContain('const size = attrs.find((a) => a.slug === "size");');
    expect(ATTRS).toContain('.update({ sizes: parseSizes(answered.join(", ")) })');
  });

  it("reads it the same way everything else does", () => {
    // "M, L, XL" is three sizes and "41,5" is one -- the same reading the
    // purchase order and the shelf give it.
    expect(ATTRS).toContain('import { parseSizes } from "@/lib/procurement";');
  });

  it("says nothing about a product type that has no size", () => {
    // A fridge must not have its sizes cleared because it was saved.
    expect(ATTRS).toContain("if (!size) return;");
  });
});

describe("the combinations come from the answers", () => {
  it("makes them on save rather than behind a button", () => {
    /* The form had an OPTIONS block under the fields -- a Size list, a
       Colour list and a "Create N options" button -- directly beneath the
       Size and Colour fields just filled in with the same values. */
    expect(ATTRS).toContain("await syncVariants(productId, attrs, result.rows);");
    expect(ATTRS).toContain("const { generateVariants } = await import(\"./variants\");");
  });

  it("splits each answer the way a list is read", () => {
    expect(ATTRS).toContain(".flatMap((r) => parseSizes(r.value)),");
  });

  it("leaves the editor with nothing to ask", () => {
    for (const gone of ["var-axes", "Choose some values", "matrixSize", "picked", "orphan"]) {
      expect(EDITOR, gone).not.toContain(gone);
    }
  });

  it("never destroys what is already there", () => {
    // The existing rows carry SKUs, prices and stock. generateVariants
    // adds what is missing, by label.
    const v = read("src/lib/actions/variants.ts");
    expect(v).toContain("newVariantsOnly(matrix, labels)");
  });
});

describe("the product page", () => {
  /* All three of these moved when the page was rebuilt on the reference.
     The specification table is in a TAB now (ProductTabs) and the
     description is in the component that owns the price
     (ProductInteractive), because on that layout the price has to react
     to the size picker beside it. The RULES are unchanged and are
     asserted against the files that now carry them -- a test that was
     left pointing at the old file would have gone green the moment the
     markup it checks stopped existing. */
  const TABS = read("src/components/ProductTabs.tsx");
  const BUY = read("src/components/ProductInteractive.tsx");

  it("keeps a long specification list from becoming the page", () => {
    /* It used to cap the list at five rows and scroll the rest. Columns
       instead: eighteen answers down one column is eighteen rows to
       scroll past, and across three it is six -- same problem, and the
       answer that does not hide anything.
       Counted rather than auto-fit: auto-fit with a 240px minimum drew
       FIVE columns on a 1440px screen, which read as five unrelated
       lists. Measured. */
    expect(TABS).toContain('<dl className="spec-cols">');
    /* MULTI-COLUMN, NOT GRID, and the difference is visible. A grid flows
       ROW-major -- item 1 top-left, item 2 top-middle, item 3 top-right
       -- so reading a column top to bottom skipped two answers between
       every line. `columns` gives contiguous lists at any number of
       answers, which is what the reference draws. */
    expect(CSS).toContain(".spec-cols{columns:1");
    expect(CSS).toMatch(/@media\(min-width:1024px\)\{\s*\.spec-cols\{columns:3\}/);
  });

  it("scrolls a description somebody pasted a page into", () => {
    expect(BUY).toContain('className="pdp-scroll" tabIndex={0}');
    expect(CSS).toMatch(/\.pdp-scroll\{max-height:\d+px;overflow-y:auto/);
  });

  it("shows a colour as a colour", () => {
    expect(TABS).toContain("<SpecValue spec={sp} />");
    expect(read("src/components/SpecValue.tsx")).toContain('spec.fieldType !== "color"');
  });
});

describe("naming a colour", () => {
  it("puts eighteen real colours where a person would put them", () => {
    /* Every one of these was checked against the palette while it was
       being tuned -- Magenta was added and the Pink, Purple and Beige
       anchors moved because three of them landed wrong. An edit to that
       list has to keep them landing here. */
    const cases: Record<string, string> = {
      "#db146b": "Magenta",  // the colour on the shop's own test product
      "#ffc0cb": "Pink", "#ff69b4": "Pink", "#800080": "Purple",
      "#f5f5dc": "Beige", "#000000": "Black", "#ffffff": "White",
      "#10233f": "Navy", "#1f6feb": "Blue", "#e0162b": "Red",
      "#ff7f0e": "Orange", "#2e7d32": "Green", "#8b4513": "Brown",
      "#808080": "Grey", "#c0c0c0": "Silver", "#ffd700": "Yellow",
      "#008080": "Teal", "#d4af37": "Gold",
    };
    for (const [hex, name] of Object.entries(cases)) {
      expect(describeColor(hex)?.name, hex).toBe(name);
    }
  });

  it("keeps the swatch and the value it came from", () => {
    // The name is an approximation over a short list; the swatch is the
    // exact answer, so nobody has to trust the word.
    expect(describeColor("#db146b")).toMatchObject({
      swatch: "#db146b", exact: "#db146b",
    });
  });

  it("does not print the hex on the product page", () => {
    /* It used to sit beside the name in small type, for a shop matching a
       supplier's code. Wrong audience: a buyer cannot use a hex, and a
       swatch with a number after it reads as one that failed to resolve. */
    const SPEC = read("src/components/SpecValue.tsx");
    expect(SPEC).toContain("{c.name}");
    expect(SPEC).not.toContain("c.exact");
    expect(SPEC).not.toContain("spec-hex");
    expect(CSS).not.toContain(".spec-hex");
  });

  it("reads the short form too", () => {
    expect(describeColor("#fff")?.name).toBe("White");
  });

  it("leaves a word the shop wrote exactly as they wrote it", () => {
    /* "Navy Blue" is their word for it and this is not the place to
       correct them. */
    const c = describeColor("Navy Blue");
    expect(c).toMatchObject({ name: "Navy Blue", exact: null });
  });

  it("draws a swatch for a word it knows, and none for one it does not", () => {
    // A black square meaning "we did not understand" is worse than none.
    expect(describeColor("Navy")?.swatch).toBe("#10233f");
    expect(describeColor("Aubergine")?.swatch).toBeNull();
  });

  it("says nothing about nothing", () => {
    expect(describeColor("")).toBeNull();
    expect(describeColor(null)).toBeNull();
  });
});

describe("a read that fails is an empty list, not a crash", () => {
  /* FOUND BY IT HAPPENING: the picker's server actions rejected with "Not
     authenticated", nothing caught it, and the unhandled rejection took
     the whole dev server down. In production it leaves the select empty
     with the error overlay up. */
  it("catches both loads", () => {
    expect(PICKER).toContain(".catch(() => { if (live) setTypes({ parent: node, list: [] }); });");
    expect(PICKER).toMatch(/\.catch\(\(\) => \{\s*\n\s*if \(!live\) return;\s*\n\s*setAttrs\(\{ type: id, list: \[\] \}\);/);
  });
});

describe("the seller's purchasing screen", () => {
  it("calls the two prices what the owner's screen calls them", () => {
    // They were "Unit price" and "Sell price" here and "Cost price" and
    // "Selling price" there, for the identical pair of columns.
    expect(SELLER).toContain('t("costPrice", lang)');
    expect(SELLER).toContain('t("sellingPrice", lang)');
    expect(SELLER).not.toContain('t("unitPrice", lang)');
  });

  it("lets a line be taken off again", () => {
    // There was an add and no undo: a line typed by mistake could only be
    // got rid of by reloading and starting the order again.
    expect(SELLER).toContain("onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}");
    expect(SELLER).toContain("disabled={lines.length === 1}");
  });
});

/* ------------------------------------------------------------------ */

describe("an editable list is keyed by the row, not the position", () => {
  /* THE BUG, in two screens that grew the same way. Both draw a list of
     rows the shop fills in, and both gained a remove button -- the
     seller's purchase order this week, the returns claim earlier. React
     pairs the rows it had against the rows it is given by key, so with
     the array position as the key, removing the first of three says "row
     2 is now row 1": the same DOM node, rewritten. State that lives in
     React survives that, because every box here is controlled. What the
     node owns does not -- the caret, the selection, which box the
     keyboard is in -- so removing a line moves the typing point onto a
     different line's words without anyone touching it.

     A list that only ever grows at the end is not affected, which is why
     neither of these was wrong when it was written and both became wrong
     the moment the remove button arrived. */

  const RETURNS = read("src/components/admin/returns/ReturnsDashboard.tsx");

  it.each([
    ["the seller's purchase order", SELLER],
    ["a returns claim", RETURNS],
  ])("keys %s by the row's own id", (_name, src) => {
    expect(src).toContain("key={l.key}");
    // And nowhere still keyed by where the row happens to sit.
    expect(src).not.toContain('key={i}>');
  });

  it.each([
    ["the seller's purchase order", SELLER],
    ["a returns claim", RETURNS],
  ])("counts new %s rows rather than measuring the list", (_name, src) => {
    /* Not `n${ls.length}`: add two rows, remove the first, and the
       length hands the next row a key a live row is still using. */
    expect(src).toContain("const seq = useRef(0);");
    expect(src).toContain("blankLine(`n${++seq.current}`)");
    expect(src).toContain('blankLine("i0")');
    expect(src).toContain('import { useMemo, useRef, useState } from "react";');
  });

  it("never reads the counter while rendering", () => {
    /* react-hooks/refs forbids it, and the reason it does is that the
       same row would render under one key on the server and another in
       the browser. Both uses must sit inside an onClick. */
    for (const src of [SELLER, RETURNS]) {
      for (const line of src.split("\n")) {
        if (line.includes("seq.current") && !line.includes("useRef")) {
          expect(line).toContain("onClick");
        }
      }
    }
  });

  it("binds each returns label to its own row's box", () => {
    /* The ids were `p${i}`, `q${i}`, `c${i}` -- positions again. A label
       and its box are written from the same `i`, so the pair always agree
       with each other within one render; what they do not do is stay with
       the row. `q1` means the second row on screen, not the row it was
       put on, so after a removal the same id names different goods --
       and anything holding onto it, an aria-describedby, a message
       pointing at #q1, is left pointing at the row that moved up. */
    for (const prefix of ["p", "pn", "q", "c"]) {
      expect(RETURNS).toContain("htmlFor={`" + prefix + "${l.key}`}");
      expect(RETURNS).toContain("id={`" + prefix + "${l.key}`}");
    }
    expect(RETURNS).not.toContain("${i}`}");
  });

  it("leaves no row without a key to be drawn by", () => {
    // A blank built by spreading a constant would have no key at all.
    for (const src of [SELLER, RETURNS]) expect(src).not.toContain("BLANK_LINE");
  });
});
