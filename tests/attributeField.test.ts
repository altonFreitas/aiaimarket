import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");
const FIELD = fs.readFileSync(
  path.join(ROOT, "src/components/admin/AttributeField.tsx"), "utf8");
const PICKER = fs.readFileSync(
  path.join(ROOT, "src/components/admin/TaxonomyPicker.tsx"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

describe("the form has never heard of a sofa", () => {
  /* Section 28 of the brief, which is the whole point of the rebuild:
     no branch anywhere on a particular category, subcategory or product
     type. If one appears, the system has stopped being dynamic and the
     next category needs a developer again. */
  it("branches on field_type and on nothing else", () => {
    for (const src of [FIELD, PICKER]) {
      expect(src).not.toMatch(/["'](shoes|sofa|smartphone|electronics|t-?shirt)["']/i);
      expect(src).not.toMatch(/category\s*===\s*["']/);
      expect(src).not.toMatch(/slug\s*===\s*["'](?!.*variant)/);
    }
  });

  it("switches on the attribute's own field_type", () => {
    expect(FIELD).toContain("switch (attr.field_type)");
  });
});

describe("the error a seller has to be able to see", () => {
  /* FOUND IN A BROWSER, NOT BY READING THE CODE. The message was in the
     DOM and correctly wired to the input for a screen reader, and rendered
     at zero by zero pixels: the stylesheet hides .field .msg and reveals
     it only under .field.err. A sighted seller got a toast saying
     something was wrong and no way to tell which field. */
  it("puts err on the wrapper, which is what reveals the message", () => {
    expect(FIELD).toContain('className={"field" + (error ? " err" : "")}');
  });

  it("still depends on that rule, so the class cannot quietly stop mattering", () => {
    // If the stylesheet ever shows .msg unconditionally this test should be
    // revisited -- but silently keeping a class that does nothing is worse.
    expect(CSS).toMatch(/\.field \.msg\{[^}]*display:none/);
    expect(CSS).toMatch(/\.field\.err \.msg\{[^}]*display:flex/);
  });

  it("ties the message to its input for a screen reader too", () => {
    // Both halves: the visible one above and this one. Neither replaces
    // the other.
    expect(FIELD).toContain('"aria-describedby": error ? `${id}-err` : undefined');
    expect(FIELD).toContain('"aria-invalid": error ? true : undefined');
    expect(FIELD).toContain("id={`${id}-err`}");
  });
});

describe("controls that would otherwise be unusable", () => {
  it("falls back to text for a select nobody has given options", () => {
    /* 415 of the specification's 546 attributes are selects whose values
       it never lists. An empty dropdown is a field nobody can fill. */
    expect(FIELD).toMatch(/case "select":\s*\n\s*if \(!attr\.options\.length\) return textInput\(\)/);
  });

  it("makes the same decision the server does", () => {
    // If the two disagreed, the form would offer a text box and the save
    // would refuse what was typed into it.
    const validate = fs.readFileSync(
      path.join(ROOT, "src/lib/taxonomy/validate.ts"), "utf8");
    expect(validate).toContain("if (!a.options.length) return checkText(a, v)");
  });

  it("gives an optional boolean a third state", () => {
    /* A checkbox cannot say "not answered" -- unticked and "no" look the
       same -- so a sofa whose Reclining nobody filled in would claim it
       does not recline. */
    expect(FIELD).toContain('{!attr.required && <option value="">—</option>}');
  });

  it("uses checkboxes rather than a multiple select", () => {
    // A <select multiple> on a phone is a scrolling box needing a modifier
    // key nobody has.
    expect(FIELD).toContain('className="attr-checks"');
    expect(FIELD).not.toMatch(/<select[^>]*\smultiple/);
  });
});

describe("the picker only draws a level that exists", () => {
  it("hides the subcategory control when a category has no children", () => {
    expect(PICKER).toContain("{visibleSubs.length > 0 && (");
    expect(PICKER).toContain("{visibleTypes.length > 0 && (");
  });

  it("clears the answers when the product type changes", () => {
    /* The answers to the old questions are not answers to the new ones --
       a sofa's Seat Height is not a smartphone's anything. The server
       would refuse them; this stops them being sent. */
    expect(PICKER).toContain("onChange({ ...value, productTypeId: id, values: {} })");
    expect(PICKER).toContain('onChange({ categoryId: id, subcategoryId: "", productTypeId: "", values: {} })');
  });

  it("never shows a list belonging to a choice already moved on from", () => {
    // Each cache remembers its parent, and rendering derives from that --
    // so a slow response for the previous category cannot flash on screen.
    expect(PICKER).toContain("subs.parent === value.categoryId");
    expect(PICKER).toContain("types.parent === typeParent");
    expect(PICKER).toContain("attrs.type === value.productTypeId");
  });

  it("drops a response that arrives after the choice moved on", () => {
    /* Each of the three effects opens a `live` flag, clears it on cleanup,
       and CONSULTS it before setting state. Asserted per effect rather than
       by counting one idiom across the file: `if (live) set(...)` and
       `if (!live) return;` are the same guarantee written two ways, and a
       test that only recognised one of them failed over a rewrite that
       changed nothing about the behaviour. */
    const effects = PICKER.split("useEffect(").slice(1);
    expect(effects).toHaveLength(3);
    for (const [i, body] of effects.entries()) {
      expect(body, `effect ${i}: no live flag`).toContain("let live = true");
      expect(body, `effect ${i}: never cleared`).toContain("live = false");
      expect(body, `effect ${i}: never consulted`).toMatch(/if \(!?live\)/);
    }
  });
});
