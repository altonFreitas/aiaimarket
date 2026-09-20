/* WHAT KIND OF FIELD EACH ATTRIBUTE IS.
 *
 * The specification names 546 distinct attributes across 267 product types
 * and says what they are CALLED. It does not say what any of them IS -- and
 * "Width" wants a number and a unit, "Waterproof" wants a checkbox, "Color"
 * wants a swatch, and "Sleeve Length" wants a list (Short, Long,
 * Three-Quarter), which is the trap: it ends in "Length" and is not a
 * measurement.
 *
 * So this file infers the field type from the name, and the order matters.
 * EXACT names are checked first and win outright; only then do the keyword
 * patterns run. That ordering is the whole design: every time a pattern
 * gets something wrong, the fix is one line in EXACT rather than a cleverer
 * regex that breaks two other attributes.
 *
 * WHY INFERENCE AT ALL, rather than typing 546 rows by hand. Because the
 * shop will add the 547th, and a hand-typed table answers nothing about it.
 * The rules below give every future attribute a sensible default, and the
 * attribute builder (P3) lets the admin correct any of them without a
 * migration -- the inferred type is a starting point stored in a row, not
 * a law.
 *
 * A SELECT WITH NO OPTIONS RENDERS AS TEXT. This is what makes the seed
 * usable on day one. 415 of the 546 attributes are closed lists in
 * principle -- Collar Type, Frame Material, Bulb Type -- but the
 * specification never lists their values, and a dropdown with nothing in it
 * is a field nobody can fill. So they are seeded as selects with an empty
 * option list, the form falls back to a text box, and the day somebody adds
 * the options in the attribute builder, that field becomes a dropdown
 * everywhere it appears. No schema change, no data migration, no code.
 */

/** The field types from section 3 of the specification. */
export type FieldType =
  | "text" | "textarea" | "richtext"
  | "number" | "decimal" | "currency"
  | "select" | "multiselect" | "boolean"
  | "color" | "image" | "file"
  | "date" | "datetime"
  | "range" | "dimensions" | "tags";

export interface AttributeSpec {
  name: string;
  slug: string;
  fieldType: FieldType;
  /** Shown after the input and stored with the value: cm, kg, W. */
  unit: string | null;
  /** May this attribute distinguish one variant from another? */
  variant: boolean;
  filterable: boolean;
  searchable: boolean;
  sortable: boolean;
  /** Seeded values. Empty means the field renders as text until an admin
   * fills them in -- see the note at the top of this file. */
  options: string[];
}

/* ---------------------------------------------------------------------------
 * Option lists worth seeding
 *
 * Only the ones whose values are genuinely universal. "Size" is not here:
 * S/M/L is clothing, EU 42 is shoes, 128GB is storage, and one list that
 * tried to cover all three would be wrong on every screen. Those come from
 * the product type, which is exactly what the attribute builder is for.
 * ------------------------------------------------------------------------ */
const OPTIONS: Record<string, string[]> = {
  gender: ["Men", "Women", "Unisex", "Boys", "Girls"],
  condition: ["New", "Used - Like New", "Used - Good", "Used - Fair", "Refurbished"],
  season: ["Spring", "Summer", "Autumn", "Winter", "All Season"],
  fit: ["Slim", "Regular", "Relaxed", "Oversized", "Athletic"],
  material: ["Cotton", "Polyester", "Wool", "Linen", "Silk", "Leather",
    "Denim", "Nylon", "Wood", "Metal", "Steel", "Aluminium", "Plastic",
    "Glass", "Ceramic", "Rubber", "Bamboo", "Marble"],
  pattern: ["Solid", "Striped", "Checked", "Floral", "Printed", "Camouflage"],
  closure: ["Button", "Zip", "Drawstring", "Elastic", "Velcro", "Buckle",
    "Snap", "Lace-Up", "Pull-On"],
};

/* ---------------------------------------------------------------------------
 * EXACT names, checked first
 *
 * Everything here is either a trap for the patterns below (Sleeve Length is
 * not a measurement; Battery Type is not a number) or common enough to be
 * worth getting exactly right rather than approximately.
 * ------------------------------------------------------------------------ */
const EXACT: Record<string, Partial<AttributeSpec> & { fieldType: FieldType }> = {
  // --- the traps: these END in a measuring word and are not measurements ---
  "sleeve length":   { fieldType: "select" },   // Short, Long, Three-Quarter
  "sleeve type":     { fieldType: "select" },
  "battery type":    { fieldType: "select" },
  "battery life":    { fieldType: "number", unit: "h" },
  "power source":    { fieldType: "select" },
  "country of origin": { fieldType: "select" },
  "shoe width":      { fieldType: "select" },   // Narrow, Regular, Wide
  // "Adjustable Height" sits beside "Seat Height Range" on the same office
  // chair: the range is the measurement, this is the yes/no.
  "adjustable height": { fieldType: "boolean" },
  "adjustable shelves": { fieldType: "boolean" },
  "adjustable strap":   { fieldType: "boolean" },
  "band size":       { fieldType: "select" },
  "cup size":        { fieldType: "select" },
  "waist size":      { fieldType: "select" },
  "breed size":      { fieldType: "select" },
  "age group":       { fieldType: "select" },
  "age rating":      { fieldType: "select" },
  "size range":      { fieldType: "select" },
  "speed range":     { fieldType: "select" },
  "height range":    { fieldType: "select" },
  "seat height range": { fieldType: "select" },
  "compression level": { fieldType: "select" },
  "support level":   { fieldType: "select" },
  "bit depth":       { fieldType: "select" },  // 16-bit, 24-bit
  "cache size":      { fieldType: "select" },
  "bcaa ratio":      { fieldType: "text" },
  "cable ratio":     { fieldType: "text" },

  // --- variant axes, from section 4 of the specification ---
  "size":       { fieldType: "select", variant: true },
  "material":   { fieldType: "select", variant: true },
  "color":      { fieldType: "color",  variant: true },
  "colour":     { fieldType: "color",  variant: true },
  "shoe size":  { fieldType: "select", variant: true },
  "storage":    { fieldType: "select", variant: true },
  "ram":        { fieldType: "select", variant: true },
  "flavor":     { fieldType: "select", variant: true },
  "flavour":    { fieldType: "select", variant: true },
  "configuration": { fieldType: "select", variant: true },
  "pack size":  { fieldType: "select", variant: true },

  // --- identity ---
  "brand":  { fieldType: "select", searchable: true, filterable: true },
  "model":  { fieldType: "text",   searchable: true },
  "sku":    { fieldType: "text",   searchable: true, filterable: false },
  "product type": { fieldType: "select" },

  // --- the measurements that carry a unit ---
  "width":  { fieldType: "number", unit: "cm" },
  "height": { fieldType: "number", unit: "cm" },
  "depth":  { fieldType: "number", unit: "cm" },
  "length": { fieldType: "number", unit: "cm" },
  "diameter": { fieldType: "number", unit: "cm" },
  "seat height": { fieldType: "number", unit: "cm" },
  "seat width":  { fieldType: "number", unit: "cm" },
  "weight": { fieldType: "number", unit: "kg", variant: true },
  "net weight": { fieldType: "number", unit: "kg" },
  "maximum load": { fieldType: "number", unit: "kg" },
  "maximum load per shelf": { fieldType: "number", unit: "kg" },
  "maximum user weight": { fieldType: "number", unit: "kg" },
  "capacity": { fieldType: "number", unit: "L" },
  "battery capacity": { fieldType: "number", unit: "mAh" },
  "screen size": { fieldType: "number", unit: "in" },
  "wattage": { fieldType: "number", unit: "W" },
  "power":   { fieldType: "number", unit: "W" },
  "power output": { fieldType: "number", unit: "W" },
  "motor power":  { fieldType: "number", unit: "W" },
  "lumens":  { fieldType: "number", unit: "lm" },
  "voltage": { fieldType: "number", unit: "V" },
  "color temperature": { fieldType: "number", unit: "K" },
  "refresh rate": { fieldType: "number", unit: "Hz" },
  "fabric weight": { fieldType: "number", unit: "gsm" },

  // --- dates ---
  "expiration date":  { fieldType: "date" },
  "publication date": { fieldType: "date" },

  // --- long text ---
  "description": { fieldType: "richtext", filterable: false, searchable: true },
  "ingredients": { fieldType: "textarea", filterable: false, searchable: true },
  "pieces included": { fieldType: "select" },   // 2-Piece, 3-Piece
  "attachments included": { fieldType: "multiselect" },
  "included accessories": { fieldType: "multiselect" },
  "allergens":   { fieldType: "multiselect" },
  "allergen information": { fieldType: "textarea", filterable: false },
  "features":    { fieldType: "multiselect" },
  "benefits":    { fieldType: "multiselect" },
  "tags":        { fieldType: "tags", filterable: false, searchable: true },
  "dimensions":  { fieldType: "dimensions", unit: "cm", filterable: false },
};

/* ---------------------------------------------------------------------------
 * Patterns, in order. First match wins.
 * ------------------------------------------------------------------------ */
const PATTERNS: Array<{
  re: RegExp; fieldType: FieldType; unit?: string | null;
}> = [
  // A yes/no question, however it is phrased.
  { re: /^(is |has )?(waterproof|water resistant|dimmable|stackable|foldable|extendable|reclining|washable|adjustable|removable|hypoallergenic|non-?slip|blackout|handmade|lockable|wireless|rechargeable|smart|included|assembly required|battery included|battery required|bpa free|food safe|oven safe|microwave safe|dishwasher safe|induction compatible|non-?stick|thermal insulation|moisture wicking|lumbar support|headrest|footrest|wheels|armrests|5g|nfc|bluetooth)$/i,
    fieldType: "boolean" },

  // A trailing adjective that answers yes or no: Cushion Removable,
  // Assembly Required, Dishwasher Safe, BPA Free, Leakproof. The two
  // exceptions -- "Attachments Included" (a list) and "Pieces Included"
  // (2-Piece, 3-Piece) -- are in EXACT, which is checked first.
  { re: /(\b(removable|required|resistant|safe|compatible|washable|included|free|slip)|proof)$/i,
    fieldType: "boolean" },

  // "Number of Seats", "Door Count", "Blade Count" -- a plain count.
  { re: /^(number of |no\. of )/i, fieldType: "number", unit: null },
  { re: /\b(count|quantity)$/i,    fieldType: "number", unit: null },

  // Measurements that were not caught exactly above.
  { re: /\b(width|height|depth|diameter|length)$/i, fieldType: "number", unit: "cm" },
  { re: /\bweight$/i,   fieldType: "number", unit: "kg" },
  { re: /\bcapacity$/i, fieldType: "number", unit: "L" },
  { re: /\bwattage$/i,  fieldType: "number", unit: "W" },
  { re: /\bvoltage$/i,  fieldType: "number", unit: "V" },
  { re: /\b(load)$/i,   fieldType: "number", unit: "kg" },

  // Anything colour-ish that was not the exact "Color".
  { re: /colou?r$/i, fieldType: "color" },

  // Dates.
  { re: /\bdate$/i, fieldType: "date" },

  // Plurals that are genuinely lists of things.
  { re: /^(attachments|accessories|amino acids|compatibility|included accessories|attachments included)/i,
    fieldType: "multiselect" },

  // Everything ending in a classifying word is a closed list -- even though
  // the specification never says what is in it. See the note at the top:
  // an empty select renders as text until somebody fills the options in.
  { re: /\b(type|style|material|shape|finish|grade|level|rating|class|format|origin|profile)$/i,
    fieldType: "select" },
];

export function slugify(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** What kind of field this attribute should be, from its name alone. */
export function inferAttribute(name: string): AttributeSpec {
  const key = name.toLowerCase().trim();
  const slug = slugify(name);

  const base: AttributeSpec = {
    name, slug,
    fieldType: "select",   // the default: a closed list we do not yet know
    unit: null, variant: false,
    filterable: true, searchable: false, sortable: false,
    options: OPTIONS[slug] ?? [],
  };

  const exact = EXACT[key];
  if (exact) return finish({ ...base, ...exact });

  for (const p of PATTERNS) {
    if (p.re.test(name)) {
      return finish({ ...base, fieldType: p.fieldType, unit: p.unit ?? null });
    }
  }
  return finish(base);
}

/** The consequences of a field type, applied in one place so they cannot
 * disagree between the exact table and the patterns. */
function finish(a: AttributeSpec): AttributeSpec {
  // Free text and long text cannot be filtered on -- a filter needs a set of
  // values to offer, and these have as many values as there are products.
  if (a.fieldType === "text" || a.fieldType === "textarea" ||
      a.fieldType === "richtext" || a.fieldType === "tags" ||
      a.fieldType === "dimensions" || a.fieldType === "image" ||
      a.fieldType === "file") {
    a.filterable = false;
  }
  // A number is worth sorting by; a dropdown is not.
  if (a.fieldType === "number" || a.fieldType === "decimal" ||
      a.fieldType === "currency") {
    a.sortable = true;
  }
  // Words a shopper might actually type.
  if (a.fieldType === "select" || a.fieldType === "multiselect" ||
      a.fieldType === "color" || a.fieldType === "text") {
    a.searchable = true;
  }
  return a;
}
