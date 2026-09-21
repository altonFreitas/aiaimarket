import { describe, it, expect } from "vitest";
import { checkLineTaxonomy, submittedFrom, LineTaxonomyError } from "@/lib/taxonomy/lineTaxonomy";
import type { FormAttribute } from "@/lib/taxonomy/types";

/* WHAT A PURCHASE ORDER LINE MAY SAY ABOUT A PRODUCT TYPE.
 *
 * The line's answers become a listing the whole internet reads, so this is
 * the last gate before they do. Every rule below names the thing it stops.
 */

const attr = (over: Partial<FormAttribute>): FormAttribute => ({
  id: "a1", name: "Colour", slug: "colour", field_type: "text", unit: null,
  is_variant: false, required: false, display_order: 0, admin_only: false,
  validation: {}, options: [], ...over,
});

const COLOUR = attr({ id: "a1", name: "Colour" });
const SIZE = attr({ id: "a2", name: "Size", slug: "size" });
const WEIGHT = attr({ id: "a3", name: "Weight", slug: "weight", field_type: "number",
  unit: "kg", validation: { min: 0, max: 500 } });

describe("a line that is not goods for resale", () => {
  it("carries no product type and no answers, whatever it was sent", () => {
    /* An office chair the shop sits on is a real purchase and must never
       become a product. Cleared rather than carried, so nothing downstream
       has to remember to ignore them. */
    expect(checkLineTaxonomy(false, "pt1", { a1: "Black" }, [COLOUR], "Chair"))
      .toEqual({ productTypeId: null, values: {} });
  });
});

describe("a line with no product type", () => {
  it("is a normal state, not an error", () => {
    expect(checkLineTaxonomy(true, "", {}, null, "Rice"))
      .toEqual({ productTypeId: null, values: {} });
    expect(checkLineTaxonomy(true, null, {}, null, "Rice"))
      .toEqual({ productTypeId: null, values: {} });
  });

  it("drops answers that no longer answer anything", () => {
    // They were answers to a type that has just been taken off the line.
    expect(checkLineTaxonomy(true, "", { a1: "Black" }, [COLOUR], "Shirt").values)
      .toEqual({});
  });
});

describe("a product type that does not exist", () => {
  it("is refused, and the line is named", () => {
    /* null is "asked for, and there is no such type" -- which is a stale
       tab, a copied id, or somebody probing. An empty list is different:
       that is a real type nobody has configured attributes for. */
    expect(() => checkLineTaxonomy(true, "ghost", {}, null, "Shirt"))
      .toThrow(LineTaxonomyError);
    expect(() => checkLineTaxonomy(true, "ghost", {}, null, "Shirt"))
      .toThrow(/"Shirt".*does not exist/);
  });

  it("is not confused with a type that simply has no fields yet", () => {
    expect(checkLineTaxonomy(true, "pt1", {}, [], "Shirt"))
      .toEqual({ productTypeId: "pt1", values: {} });
  });
});

describe("the answers themselves", () => {
  it("keeps what fits", () => {
    const out = checkLineTaxonomy(true, "pt1",
      { a1: "Black", a2: "41,5" }, [COLOUR, SIZE], "Shoe");
    expect(out).toEqual({ productTypeId: "pt1", values: { a1: ["Black"], a2: ["41,5"] } });
  });

  it("refuses an attribute the product type never asked for", () => {
    /* The attack this is shaped around: a well-formed value attached to an
       attribute that has nothing to do with the goods. Refused rather than
       dropped -- a save that looks successful while losing what somebody
       typed is the worse failure, because they find out weeks later. */
    expect(() => checkLineTaxonomy(true, "pt1",
      { a1: "Black", a9: "Storage" }, [COLOUR], "Shirt"))
      .toThrow(/does not belong to this product type/);
  });

  it("refuses a value that does not fit its field", () => {
    expect(() => checkLineTaxonomy(true, "pt1", { a3: "heavy" }, [WEIGHT], "Sack"))
      .toThrow(LineTaxonomyError);
    expect(() => checkLineTaxonomy(true, "pt1", { a3: "900" }, [WEIGHT], "Sack"))
      .toThrow(LineTaxonomyError);
  });

  it("does NOT insist on a required field", () => {
    /* A buyer on the phone to a supplier at eight in the morning may not
       know the composition yet. Refusing to record the purchase until they
       do means the purchase goes unrecorded, which is worse than a listing
       that has to be finished later -- and the product form still asks. */
    const required = attr({ id: "a1", name: "Composition", required: true });
    expect(checkLineTaxonomy(true, "pt1", {}, [required], "Shirt"))
      .toEqual({ productTypeId: "pt1", values: {} });
  });

  it("still refuses a BAD value for a required field", () => {
    // Relaxing "you must answer" is not relaxing "this is not an answer".
    const req = attr({ ...WEIGHT, required: true });
    expect(() => checkLineTaxonomy(true, "pt1", { a3: "heavy" }, [req], "Sack"))
      .toThrow(LineTaxonomyError);
  });

  it("drops an empty answer rather than storing a blank", () => {
    expect(checkLineTaxonomy(true, "pt1",
      { a1: "Black", a2: "" }, [COLOUR, SIZE], "Shirt").values)
      .toEqual({ a1: ["Black"] });
  });

  it("stores the canonical value, not whatever arrived", () => {
    /* Rebuilt from the validated rows. Passing the raw submission through
       would let the line and the product it creates disagree about the
       same answer. */
    const sel = attr({ id: "a1", name: "Colour", field_type: "select",
      options: [{ label: "Preto", value: "black" }] });
    expect(checkLineTaxonomy(true, "pt1", { a1: "black" }, [sel], "Shirt").values)
      .toEqual({ a1: ["black"] });
  });

  it("keeps every value of a multi-value field", () => {
    const tags = attr({ id: "a1", name: "Care", field_type: "multiselect",
      options: [{ label: "Wash", value: "wash" }, { label: "Iron", value: "iron" }] });
    expect(checkLineTaxonomy(true, "pt1", { a1: ["wash", "iron"] }, [tags], "Shirt").values)
      .toEqual({ a1: ["wash", "iron"] });
  });
});

describe("reading the column back", () => {
  it("drops empty lists, so a blank never reaches the validator as an answer", () => {
    expect(submittedFrom({ a1: ["Black"], a2: [] })).toEqual({ a1: ["Black"] });
  });

  it("copes with a column that is null or absent", () => {
    expect(submittedFrom(null)).toEqual({});
    expect(submittedFrom(undefined)).toEqual({});
  });
});
