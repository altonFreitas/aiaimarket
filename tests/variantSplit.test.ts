import { describe, it, expect } from "vitest";
import { variantValueSets, MAX_VARIANTS, TooManyVariants } from "@/lib/taxonomy/variantMatrix";

/* SPLITTING ONE PURCHASE ORDER LINE INTO ONE LINE PER SKU.
 *
 * The buyer fills in one line -- the product, the category, the type, the
 * composition, the brand -- then says "S, M, L" once and gets three lines
 * that agree about all of it and differ in the size. Everything this has
 * to get right is about what is carried and what is replaced.
 */

const SIZE = "attr-size";
const COLOUR = "attr-colour";
const FABRIC = "attr-fabric";

describe("what a line becomes", () => {
  it("makes one set per value of a single axis", () => {
    const out = variantValueSets({}, [
      { attributeId: SIZE, name: "Size", values: ["S", "M", "L"] },
    ]);
    expect(out).toEqual([
      { [SIZE]: ["S"] }, { [SIZE]: ["M"] }, { [SIZE]: ["L"] },
    ]);
  });

  it("multiplies two axes, last one varying fastest", () => {
    /* The order a size chart reads in, and it matters: these labels end up
       on order lines and in the stock report, and a shop should find them
       grouped the way it thinks about them. */
    const out = variantValueSets({}, [
      { attributeId: COLOUR, name: "Colour", values: ["Black", "White"] },
      { attributeId: SIZE, name: "Size", values: ["S", "M"] },
    ]);
    expect(out.map((v) => `${v[COLOUR][0]}/${v[SIZE][0]}`))
      .toEqual(["Black/S", "Black/M", "White/S", "White/M"]);
  });

  it("carries every answer that is not an axis", () => {
    /* The composition is a property of the PRODUCT, not of the SKU. If
       this were dropped, twelve generated lines would each lose the
       fourteen answers the buyer had just typed once. */
    const out = variantValueSets(
      { [FABRIC]: ["Cotton"], [SIZE]: ["S"] },
      [{ attributeId: SIZE, name: "Size", values: ["M", "L"] }]);
    expect(out).toEqual([
      { [FABRIC]: ["Cotton"], [SIZE]: ["M"] },
      { [FABRIC]: ["Cotton"], [SIZE]: ["L"] },
    ]);
  });

  it("replaces the axis the line already answered rather than keeping both", () => {
    const out = variantValueSets({ [SIZE]: ["XXL"] },
      [{ attributeId: SIZE, name: "Size", values: ["S"] }]);
    expect(out).toEqual([{ [SIZE]: ["S"] }]);
  });

  it("leaves the line's own answers untouched", () => {
    // The caller keeps rendering the original line until setState lands.
    const base = { [FABRIC]: ["Cotton"] };
    variantValueSets(base, [{ attributeId: SIZE, name: "Size", values: ["S"] }]);
    expect(base).toEqual({ [FABRIC]: ["Cotton"] });
  });
});

describe("what it refuses", () => {
  it("returns nothing when no axis has a value", () => {
    /* Not one set -- nothing. "Nothing to split on" is a message; silently
       replacing the line with a copy of itself is a bug that looks like
       the button not working. */
    expect(variantValueSets({}, [])).toEqual([]);
    expect(variantValueSets({},
      [{ attributeId: SIZE, name: "Size", values: [] }])).toEqual([]);
    expect(variantValueSets({},
      [{ attributeId: SIZE, name: "Size", values: ["", "  "] }])).toEqual([]);
  });

  it("collapses duplicates rather than making two lines with one label", () => {
    // product_variants is unique on (product_id, label): two identical
    // combinations would fail the second receipt, not the typing.
    expect(variantValueSets({},
      [{ attributeId: SIZE, name: "Size", values: ["M", "m ", "M"] }]))
      .toEqual([{ [SIZE]: ["M"] }, { [SIZE]: ["m"] }]);
  });

  it("refuses to make more lines than a person can check", () => {
    const many = Array.from({ length: 21 }, (_, i) => String(i));
    expect(() => variantValueSets({}, [
      { attributeId: SIZE, name: "Size", values: many },
      { attributeId: COLOUR, name: "Colour", values: many },
    ])).toThrow(TooManyVariants);
    // And says how many, so the shop knows what it asked for.
    expect(() => variantValueSets({}, [
      { attributeId: SIZE, name: "Size", values: many },
      { attributeId: COLOUR, name: "Colour", values: many },
    ])).toThrow(new RegExp(String(21 * 21)));
  });

  it("allows exactly the cap", () => {
    const out = variantValueSets({}, [{
      attributeId: SIZE, name: "Size",
      values: Array.from({ length: MAX_VARIANTS }, (_, i) => String(i)),
    }]);
    expect(out).toHaveLength(MAX_VARIANTS);
  });
});
