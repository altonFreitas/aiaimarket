import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { inferAttribute, slugify, type FieldType } from "@/lib/taxonomy/fieldTypes";

/* The specification names 546 attributes and says what none of them IS.
 * These are the rules that decide, so a wrong one silently gives a whole
 * category the wrong form. */

describe("slugify", () => {
  it("makes a stable key out of a display name", () => {
    expect(slugify("Maximum Load Per Shelf")).toBe("maximum_load_per_shelf");
    expect(slugify("Heel-to-Toe Drop")).toBe("heel_to_toe_drop");
    expect(slugify("Wall Mounted/Freestanding")).toBe("wall_mounted_freestanding");
  });
  it("leaves no leading or trailing separator", () => {
    expect(slugify("  5G  ")).toBe("5g");
    expect(slugify("Cushion Removable?")).toBe("cushion_removable");
  });
});

describe("the traps", () => {
  /* Each of these ends in a word that the patterns key on, and is not the
   * thing that word suggests. Every one was found by reading the parsed
   * specification, not by guessing. */
  it("does not measure a sleeve in centimetres", () => {
    // Short / Long / Three-Quarter, not 40cm.
    expect(inferAttribute("Sleeve Length").fieldType).toBe("select");
    expect(inferAttribute("Sleeve Length").unit).toBeNull();
  });
  it("still measures every other length", () => {
    for (const n of ["Bar Length", "Cable Length", "GPU Length", "Rail Length"]) {
      const a = inferAttribute(n);
      expect(a.fieldType, n).toBe("number");
      expect(a.unit, n).toBe("cm");
    }
  });
  it("treats bit depth as a choice, not a depth", () => {
    expect(inferAttribute("Bit Depth").fieldType).toBe("select");
  });
  it("treats adjustable height as a yes/no, beside the range that measures it", () => {
    // Office Chairs carry both in the specification.
    expect(inferAttribute("Adjustable Height").fieldType).toBe("boolean");
    expect(inferAttribute("Seat Height Range").fieldType).toBe("select");
    expect(inferAttribute("Seat Height").fieldType).toBe("number");
  });
  it("does not turn battery type, power source or origin into numbers", () => {
    for (const n of ["Battery Type", "Power Source", "Country of Origin"]) {
      expect(inferAttribute(n).fieldType, n).toBe("select");
    }
  });
  it("measures colour temperature but swatches every other colour", () => {
    expect(inferAttribute("Color Temperature").fieldType).toBe("number");
    expect(inferAttribute("Color Temperature").unit).toBe("K");
    for (const n of ["Color", "Frame Color", "Strap Color", "Lens Color"]) {
      expect(inferAttribute(n).fieldType, n).toBe("color");
    }
  });
  it("treats every '* Size' as a choice except a screen", () => {
    for (const n of ["Band Size", "Cup Size", "Waist Size", "Pack Size",
                     "Mattress Size", "Paper Size", "Cache Size"]) {
      expect(inferAttribute(n).fieldType, n).toBe("select");
    }
    expect(inferAttribute("Screen Size").fieldType).toBe("number");
    expect(inferAttribute("Screen Size").unit).toBe("in");
  });
});

describe("the trailing adjective that asks a yes/no question", () => {
  /* Found by reading the seeded Sofa back out of a real database: "Cushion
   * Removable" had come out a dropdown, because it ends in a word the
   * classification rule keys on. */
  it("reads them as booleans", () => {
    for (const n of ["Cushion Removable", "Assembly Required", "Dishwasher Safe",
                     "Oven Safe", "Induction Compatible", "Chew Resistant",
                     "BPA Free", "Washable", "Non-Slip", "Battery Included"]) {
      expect(inferAttribute(n).fieldType, n).toBe("boolean");
    }
  });

  it("matches inside a single word too", () => {
    // "Leakproof" has no word boundary before "proof", so a \b rule missed
    // it and it came out a dropdown.
    expect(inferAttribute("Leakproof").fieldType).toBe("boolean");
    expect(inferAttribute("Waterproof").fieldType).toBe("boolean");
  });

  it("keeps the three that are not yes/no questions", () => {
    // "Included" is the ambiguous one: a battery is yes/no, attachments are
    // a list, and a tracksuit's pieces are 2-Piece or 3-Piece.
    expect(inferAttribute("Attachments Included").fieldType).toBe("multiselect");
    expect(inferAttribute("Included Accessories").fieldType).toBe("multiselect");
    expect(inferAttribute("Pieces Included").fieldType).toBe("select");
  });

  it("does not swallow a classification that merely ends in a noun", () => {
    for (const n of ["Frame Material", "Room Type", "Closure", "Style"]) {
      expect(inferAttribute(n).fieldType, n).toBe("select");
    }
  });
});

describe("variant axes", () => {
  it("marks exactly the axes section 4 of the specification lists", () => {
    for (const n of ["Size", "Color", "Material", "Storage", "RAM", "Flavor",
                     "Weight", "Shoe Size", "Configuration", "Pack Size"]) {
      expect(inferAttribute(n).variant, n).toBe(true);
    }
  });
  it("does not make a description or a brand a variant axis", () => {
    for (const n of ["Brand", "Description", "Model", "Waterproof", "Width"]) {
      expect(inferAttribute(n).variant, n).toBe(false);
    }
  });
});

describe("the consequences of a field type", () => {
  it("never offers a filter on free text", () => {
    // A filter needs a set of values to offer. These have as many values as
    // there are products, so the filter would be a list of every product.
    for (const n of ["Model", "Description", "Ingredients", "Dimensions"]) {
      expect(inferAttribute(n).filterable, n).toBe(false);
    }
  });
  it("sorts numbers and not dropdowns", () => {
    expect(inferAttribute("Width").sortable).toBe(true);
    expect(inferAttribute("Maximum Load").sortable).toBe(true);
    expect(inferAttribute("Material").sortable).toBe(false);
  });
  it("seeds options only where they are universal", () => {
    // Gender and Season mean the same thing everywhere.
    expect(inferAttribute("Gender").options).toContain("Unisex");
    expect(inferAttribute("Season").options).toContain("All Season");
    // Size does not: S/M/L is clothing, EU 42 is shoes, 128GB is storage.
    // One list covering all three would be wrong on every screen.
    expect(inferAttribute("Size").options).toEqual([]);
  });
});

describe("across the whole specification", () => {
  const NAMES = fs.existsSync("/tmp/spec/attrs.txt")
    ? fs.readFileSync("/tmp/spec/attrs.txt", "utf8").trim().split("\n")
        .map((l) => l.split("\t")[1]).filter(Boolean)
    : [];

  it("gives every attribute a slug that is unique to its name", () => {
    // Two different attributes colliding on one slug would silently merge
    // into a single row, and every product type using either would get
    // whichever one was inserted last.
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const n of NAMES) {
      const s = slugify(n);
      const prev = seen.get(s);
      if (prev && prev !== n) collisions.push(`${prev} / ${n} -> ${s}`);
      seen.set(s, n);
    }
    expect(collisions).toEqual([]);
  });

  it("never returns an empty or unknown field type", () => {
    const allowed: FieldType[] = ["text", "textarea", "richtext", "number",
      "decimal", "currency", "select", "multiselect", "boolean", "color",
      "image", "file", "date", "datetime", "range", "dimensions", "tags"];
    for (const n of NAMES) {
      expect(allowed, n).toContain(inferAttribute(n).fieldType);
    }
  });

  it("gives every number a unit or a deliberate absence of one", () => {
    // A number with no unit is fine -- "Number of Seats" -- but it has to
    // be null rather than an empty string, which would render as "12 ".
    for (const n of NAMES) {
      const a = inferAttribute(n);
      if (a.fieldType === "number") {
        expect(a.unit === null || a.unit.length > 0, `${n}: ${a.unit}`).toBe(true);
      }
    }
  });

  it("is deterministic", () => {
    // The seed is generated from this. If it varied, two runs would write
    // two different databases.
    for (const n of NAMES.slice(0, 200)) {
      expect(inferAttribute(n)).toEqual(inferAttribute(n));
    }
  });
});
