import { describe, it, expect } from "vitest";
import {
  buildMatrix, matrixSize, newVariantsOnly, orphanedLabels,
  MAX_VARIANTS, TooManyVariants, type VariantAxis,
} from "@/lib/taxonomy/variantMatrix";

const axis = (id: string, name: string, values: string[]): VariantAxis =>
  ({ attributeId: id, name, values });

describe("the multiplication", () => {
  it("makes every combination, last axis varying fastest", () => {
    // The order a size chart reads in: all the blacks, then all the whites.
    const out = buildMatrix([
      axis("c", "Colour", ["Black", "White"]),
      axis("s", "Size", ["S", "M", "L"]),
    ]);
    expect(out.map((v) => v.label)).toEqual([
      "Black / S", "Black / M", "Black / L",
      "White / S", "White / M", "White / L",
    ]);
  });

  it("records what distinguishes each one, not just its name", () => {
    const out = buildMatrix([
      axis("c", "Colour", ["Black"]),
      axis("s", "Size", ["M"]),
    ]);
    expect(out[0].values).toEqual([
      { attributeId: "c", value: "Black" },
      { attributeId: "s", value: "M" },
    ]);
  });

  it("handles a single axis without inventing a separator", () => {
    const out = buildMatrix([axis("s", "Size", ["S", "M"])]);
    expect(out.map((v) => v.label)).toEqual(["S", "M"]);
  });

  it("handles three axes", () => {
    const out = buildMatrix([
      axis("c", "Colour", ["Black", "White"]),
      axis("s", "Size", ["S", "M"]),
      axis("t", "Storage", ["128GB", "256GB"]),
    ]);
    expect(out).toHaveLength(8);
    expect(out[0].label).toBe("Black / S / 128GB");
    expect(out[7].label).toBe("White / M / 256GB");
  });
});

describe("axes that are not really axes", () => {
  it("ignores one with nothing chosen rather than producing nothing", () => {
    /* Multiplying by an empty axis gives zero combinations, so a half-filled
       form would silently produce no variants at all and look broken. */
    const out = buildMatrix([
      axis("c", "Colour", ["Black", "White"]),
      axis("s", "Size", []),
    ]);
    expect(out.map((v) => v.label)).toEqual(["Black", "White"]);
  });

  it("returns nothing when no axis has anything", () => {
    expect(buildMatrix([])).toEqual([]);
    expect(buildMatrix([axis("c", "Colour", [])])).toEqual([]);
  });

  it("collapses a duplicated value instead of failing the save", () => {
    // Two identical labels would hit the unique index. Failing a whole
    // save over a double-click is not a useful error.
    const out = buildMatrix([axis("c", "Colour", ["Black", "Black", "White"])]);
    expect(out.map((v) => v.label)).toEqual(["Black", "White"]);
  });

  it("ignores blank values", () => {
    const out = buildMatrix([axis("c", "Colour", ["Black", "  ", ""])]);
    expect(out.map((v) => v.label)).toEqual(["Black"]);
  });
});

describe("the cap", () => {
  it("counts before building", () => {
    expect(matrixSize([
      axis("a", "A", ["1", "2", "3"]),
      axis("b", "B", ["x", "y"]),
    ])).toBe(6);
    expect(matrixSize([])).toBe(0);
  });

  it("refuses rather than writing a thousand rows", () => {
    /* Three axes of ten is a thousand variants, a picker nobody can use
       and a stock report nobody can read. A shop that ticked that many
       boxes almost certainly meant something smaller. */
    const big = [
      axis("a", "A", Array.from({ length: 10 }, (_, i) => `a${i}`)),
      axis("b", "B", Array.from({ length: 10 }, (_, i) => `b${i}`)),
      axis("c", "C", Array.from({ length: 10 }, (_, i) => `c${i}`)),
    ];
    expect(() => buildMatrix(big)).toThrow(TooManyVariants);
    try { buildMatrix(big); } catch (e) {
      expect((e as Error).message).toContain("1000");
      expect((e as Error).message).toContain(String(MAX_VARIANTS));
    }
  });

  it("allows exactly the limit", () => {
    const at = [
      axis("a", "A", Array.from({ length: 10 }, (_, i) => `a${i}`)),
      axis("b", "B", Array.from({ length: 20 }, (_, i) => `b${i}`)),
    ];
    expect(matrixSize(at)).toBe(MAX_VARIANTS);
    expect(buildMatrix(at)).toHaveLength(MAX_VARIANTS);
  });
});

describe("regenerating must not destroy", () => {
  /* The case that matters: a shop adds a fourth size to a shirt already
     selling three. It wants ONE more variant, not twelve replacements --
     the existing ones carry SKUs, prices, barcodes and stock. */

  it("returns only the combinations that are new", () => {
    const made = buildMatrix([
      axis("s", "Size", ["S", "M", "L", "XL"]),
    ]);
    const fresh = newVariantsOnly(made, ["S", "M", "L"]);
    expect(fresh.map((v) => v.label)).toEqual(["XL"]);
  });

  it("returns nothing new when nothing changed", () => {
    const made = buildMatrix([axis("s", "Size", ["S", "M"])]);
    expect(newVariantsOnly(made, ["S", "M"])).toEqual([]);
  });

  it("names what the axes no longer produce, rather than deleting it", () => {
    /* "White / XL" may still be six units on a shelf. Somebody has to be
       told, not have the row that says so quietly erased. */
    const made = buildMatrix([axis("c", "Colour", ["Black"])]);
    expect(orphanedLabels(made, ["Black", "White"])).toEqual(["White"]);
  });

  it("reports no orphans when the matrix still covers everything", () => {
    const made = buildMatrix([axis("c", "Colour", ["Black", "White"])]);
    expect(orphanedLabels(made, ["Black"])).toEqual([]);
  });
});
