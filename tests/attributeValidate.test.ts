import { describe, it, expect } from "vitest";
import { validateAttributeValues } from "@/lib/taxonomy/validate";
import type { FormAttribute } from "@/lib/taxonomy/types";

/** A FormAttribute with sensible defaults, so each test states only what
 * it is about. */
function attr(over: Partial<FormAttribute> & { id: string }): FormAttribute {
  return {
    name: "Field", slug: "field", field_type: "text", unit: null,
    is_variant: false, required: false, display_order: 0, admin_only: false,
    validation: {}, options: [], ...over,
  };
}

const WIDTH = attr({ id: "a1", name: "Width", slug: "width",
  field_type: "number", unit: "cm", validation: { min: 1, max: 500 } });
const COLOR = attr({ id: "a2", name: "Color", slug: "color",
  field_type: "select",
  options: [{ label: "Black", value: "Black" }, { label: "White", value: "White" }] });
const WATERPROOF = attr({ id: "a3", name: "Waterproof", slug: "waterproof",
  field_type: "boolean" });
const FEATURES = attr({ id: "a4", name: "Features", slug: "features",
  field_type: "multiselect",
  options: [{ label: "A", value: "A" }, { label: "B", value: "B" }] });
const COLLAR = attr({ id: "a5", name: "Collar Type", slug: "collar_type",
  field_type: "select" });   // a select with NO options -- a text box

describe("the attack this is shaped around", () => {
  it("refuses an attribute the product type never asked for", () => {
    // The real one: a crafted request posting Storage against a sofa.
    const r = validateAttributeValues([WIDTH], { "not-on-this-form": "256GB" });
    expect(r.ok).toBe(false);
    expect(r.errors["not-on-this-form"]).toMatch(/does not belong/i);
  });

  it("refuses rather than quietly dropping it", () => {
    // Ignoring it would let the save report success while losing what the
    // person typed -- they find out weeks later.
    const r = validateAttributeValues([WIDTH], { a1: "50", bogus: "x" });
    expect(r.ok).toBe(false);
    expect(r.rows).toEqual([]);   // nothing is written when anything fails
  });

  it("never emits a row for an attribute that was not offered", () => {
    const r = validateAttributeValues([WIDTH], { a1: "50", bogus: "x" });
    expect(r.rows.some((row) => row.attribute_id === "bogus")).toBe(false);
  });
});

describe("required", () => {
  it("catches a required field that was left out entirely", () => {
    // Driven by the attribute list, not by what was posted -- a field
    // omitted from the payload has to be caught too.
    const r = validateAttributeValues([{ ...WIDTH, required: true }], {});
    expect(r.ok).toBe(false);
    expect(r.errors.a1).toMatch(/required/i);
  });

  it("catches a required field posted as whitespace", () => {
    const r = validateAttributeValues([{ ...WIDTH, required: true }], { a1: "   " });
    expect(r.ok).toBe(false);
  });

  it("lets an optional field be absent without complaint", () => {
    const r = validateAttributeValues([WIDTH], {});
    expect(r.ok).toBe(true);
    expect(r.rows).toEqual([]);
  });
});

describe("numbers", () => {
  it("stores the number as well as the text", () => {
    // '100' sorts before '99' as text, so a range filter needs the number.
    const r = validateAttributeValues([WIDTH], { a1: "220" });
    expect(r.ok).toBe(true);
    expect(r.rows).toEqual([{ attribute_id: "a1", value: "220", value_num: 220 }]);
  });

  it("refuses something that is not a number", () => {
    expect(validateAttributeValues([WIDTH], { a1: "wide" }).ok).toBe(false);
    expect(validateAttributeValues([WIDTH], { a1: "12cm" }).ok).toBe(false);
  });

  it("enforces min and max from the attribute's own rules", () => {
    expect(validateAttributeValues([WIDTH], { a1: "0" }).errors.a1).toMatch(/at least 1/);
    expect(validateAttributeValues([WIDTH], { a1: "900" }).errors.a1).toMatch(/at most 500/);
    expect(validateAttributeValues([WIDTH], { a1: "500" }).ok).toBe(true);
  });

  it("leaves value_num null for everything that is not a number", () => {
    const r = validateAttributeValues([COLOR], { a2: "Black" });
    expect(r.rows[0].value_num).toBeNull();
  });
});

describe("closed lists", () => {
  it("refuses a value that is not one of the options", () => {
    const r = validateAttributeValues([COLOR], { a2: "Turquoise" });
    expect(r.ok).toBe(false);
    expect(r.errors.a2).toMatch(/not one of the choices/i);
  });

  it("accepts one that is", () => {
    expect(validateAttributeValues([COLOR], { a2: "Black" }).ok).toBe(true);
  });

  it("accepts free text for a select with no options yet", () => {
    /* 415 of the specification's 546 attributes are selects whose values it
       never lists. The form renders those as text boxes, so enforcing
       membership of an empty list would refuse every one of them. */
    const r = validateAttributeValues([COLLAR], { a5: "Button-Down" });
    expect(r.ok).toBe(true);
    expect(r.rows[0].value).toBe("Button-Down");
  });

  it("starts enforcing the moment options exist", () => {
    const withOptions = { ...COLLAR,
      options: [{ label: "Spread", value: "Spread" }] };
    expect(validateAttributeValues([withOptions], { a5: "Button-Down" }).ok).toBe(false);
    expect(validateAttributeValues([withOptions], { a5: "Spread" }).ok).toBe(true);
  });
});

describe("single versus multiple values", () => {
  it("lets a multi-select carry several, as one row each", () => {
    const r = validateAttributeValues([FEATURES], { a4: ["A", "B"] });
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(2);
    expect(r.rows.map((x) => x.value).sort()).toEqual(["A", "B"]);
  });

  it("refuses several values for a field that takes one", () => {
    const r = validateAttributeValues([COLOR], { a2: ["Black", "White"] });
    expect(r.ok).toBe(false);
    expect(r.errors.a2).toMatch(/single value/i);
  });

  it("collapses a duplicate rather than failing the save", () => {
    // The unique key would reject the second copy anyway, and failing
    // because somebody ticked a box twice is not a useful error.
    const r = validateAttributeValues([FEATURES], { a4: ["A", "A", "B"] });
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(2);
  });
});

describe("booleans", () => {
  it("stores one spelling, whatever case was posted", () => {
    // 'TRUE' and 'true' as two stored answers would make a filter on
    // "Waterproof = true" miss half the products.
    const r = validateAttributeValues([WATERPROOF], { a3: "TRUE" });
    expect(r.rows[0].value).toBe("true");
  });

  it("refuses anything that is not yes or no", () => {
    expect(validateAttributeValues([WATERPROOF], { a3: "maybe" }).ok).toBe(false);
    expect(validateAttributeValues([WATERPROOF], { a3: "1" }).ok).toBe(false);
  });
});

describe("text rules", () => {
  it("honours maxLength and pattern", () => {
    const sku = attr({ id: "s", name: "SKU", field_type: "text",
      validation: { maxLength: 5, pattern: "^[A-Z]+$" } });
    expect(validateAttributeValues([sku], { s: "ABCDEFG" }).ok).toBe(false);
    expect(validateAttributeValues([sku], { s: "abc" }).ok).toBe(false);
    expect(validateAttributeValues([sku], { s: "ABC" }).ok).toBe(true);
  });

  it("ignores a pattern the shop has mis-typed", () => {
    // A broken regex is the shop's configuration error. Refusing the
    // seller's perfectly good value for it punishes the wrong person.
    const broken = attr({ id: "b", field_type: "text",
      validation: { pattern: "([unclosed" } });
    expect(validateAttributeValues([broken], { b: "anything" }).ok).toBe(true);
  });
});

describe("dates and colours", () => {
  it("takes a real date and refuses a non-date", () => {
    const d = attr({ id: "d", name: "Expiration Date", field_type: "date" });
    expect(validateAttributeValues([d], { d: "2026-12-31" }).ok).toBe(true);
    expect(validateAttributeValues([d], { d: "soon" }).ok).toBe(false);
  });

  it("takes both a hex swatch and a colour name", () => {
    const c = attr({ id: "c", name: "Color", field_type: "color" });
    expect(validateAttributeValues([c], { c: "#1a1a1a" }).ok).toBe(true);
    expect(validateAttributeValues([c], { c: "Black" }).ok).toBe(true);
  });
});
