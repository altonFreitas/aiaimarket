import type { FieldType } from "./fieldTypes";
import type { FormAttribute } from "./types";
import { MULTI_VALUE, NUMERIC } from "./types";

/* CHECKING WHAT THE FORM SENT BACK.
 *
 * Sections 22 and 25 of the brief, in one place, because they are the same
 * job: the browser decides what to DRAW, and this decides what is TRUE.
 *
 * THE ATTACK THIS IS SHAPED AROUND is not a malformed value -- it is a
 * well-formed one attached to an attribute that has nothing to do with the
 * product. A form posts attribute ids, and nothing stops a second window,
 * a stale tab or a crafted request from posting the id of "Storage"
 * against a sofa, or an admin-only attribute the seller never saw. So the
 * ONLY attributes considered are the ones the product type actually asks
 * for: anything else is not corrected, it is refused, and the save fails
 * rather than half-succeeding.
 *
 * REFUSED RATHER THAN DROPPED, deliberately. Silently ignoring an unknown
 * attribute would let a save look successful while losing data the person
 * typed, which is the worse failure -- they find out weeks later.
 */

export interface ValidationResult {
  ok: boolean;
  /** attribute id -> what is wrong with it, for the form to show in place. */
  errors: Record<string, string>;
  /** The rows to write, once ok. One per VALUE -- a multi-select yields
   * several -- matching product_attribute_values. */
  rows: { attribute_id: string; value: string; value_num: number | null }[];
}

/** What the form posts: attribute id -> one value, or several. */
export type Submitted = Record<string, string | string[] | undefined>;

export function validateAttributeValues(
  attrs: readonly FormAttribute[], submitted: Submitted
): ValidationResult {
  const errors: Record<string, string> = {};
  const rows: ValidationResult["rows"] = [];
  const known = new Map(attrs.map((a) => [a.id, a]));

  /* 1. ANYTHING THIS PRODUCT TYPE DID NOT ASK FOR.
        Checked first and fatally: an id that is not on this form is either
        a bug or somebody probing, and neither should reach the database. */
  for (const id of Object.keys(submitted)) {
    if (!known.has(id)) {
      errors[id] = "That field does not belong to this product type.";
    }
  }

  /* 2. EVERY ATTRIBUTE THE PRODUCT TYPE DOES ASK FOR. Driven by the
        attribute list rather than by what was posted, so a required field
        that was left out entirely is still caught. */
  for (const a of attrs) {
    const raw = submitted[a.id];
    const values = normalize(raw, a.field_type);

    if (!values.length) {
      if (a.required) errors[a.id] = `${a.name} is required.`;
      continue;   // Optional and empty: nothing to store, and not an error.
    }

    if (!MULTI_VALUE.has(a.field_type) && values.length > 1) {
      errors[a.id] = `${a.name} takes a single value.`;
      continue;
    }

    const checked: typeof rows = [];
    let failed = false;

    for (const v of values) {
      const problem = checkOne(a, v);
      if (problem) { errors[a.id] = problem; failed = true; break; }
      checked.push({
        attribute_id: a.id,
        value: canonical(a, v),
        value_num: NUMERIC.has(a.field_type) ? Number(v) : null,
      });
    }
    if (!failed) rows.push(...checked);
  }

  /* NO ROWS WHEN ANYTHING FAILED.
     They could be returned -- the valid ones are valid -- but then a
     caller that forgot to check `ok` would write a partial answer and
     report success, which is the failure that gets found weeks later. An
     empty list makes that misuse impossible rather than merely
     discouraged. */
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, rows: ok ? rows : [] };
}

/** One value against one attribute. Returns the complaint, or null. */
function checkOne(a: FormAttribute, value: string): string | null {
  const v = value.trim();
  if (!v) return null;   // Blanks were dropped by normalize().

  switch (a.field_type) {
    case "number": case "decimal": case "currency": case "range": {
      const n = Number(v);
      if (!Number.isFinite(n)) return `${a.name} must be a number.`;
      const { min, max } = a.validation;
      if (min != null && n < min) return `${a.name} must be at least ${min}.`;
      if (max != null && n > max) return `${a.name} must be at most ${max}.`;
      return null;
    }

    case "boolean":
      return /^(true|false)$/i.test(v)
        ? null : `${a.name} must be yes or no.`;

    case "select": case "multiselect": {
      /* AN ATTRIBUTE WITH NO OPTIONS IS A TEXT BOX, and this is where that
         decision has to hold on the server too. 415 of the specification's
         546 attributes are selects whose values it never lists; the form
         renders those as free text, so refusing a value for not being
         among zero options would refuse every one of them. Once somebody
         fills the options in, the list becomes a closed set and is
         enforced from that moment -- for new saves, not retroactively. */
      if (!a.options.length) return checkText(a, v);
      return a.options.some((o) => o.value === v)
        ? null : `${a.name}: "${v}" is not one of the choices.`;
    }

    case "color":
      // A swatch posts hex; a shop typing "Black" into an unstyled field
      // is also a real answer, so both are allowed.
      return /^#[0-9a-f]{3,8}$/i.test(v) || /^[\w\s-]{1,40}$/.test(v)
        ? null : `${a.name} must be a colour.`;

    case "date": case "datetime":
      return Number.isFinite(Date.parse(v))
        ? null : `${a.name} must be a date.`;

    default:
      return checkText(a, v);
  }
}

function checkText(a: FormAttribute, v: string): string | null {
  const { maxLength, pattern } = a.validation;
  if (maxLength != null && v.length > maxLength) {
    return `${a.name} must be ${maxLength} characters or fewer.`;
  }
  if (pattern) {
    let re: RegExp;
    try { re = new RegExp(pattern); }
    // A broken pattern is the shop's configuration error, not the
    // seller's. Refusing their perfectly good value for it would be
    // punishing the wrong person, so an unusable rule is no rule.
    catch { return null; }
    if (!re.test(v)) return `${a.name} is not in the expected format.`;
  }
  return null;
}

/** What actually gets stored, once it is known to be valid. */
function canonical(a: FormAttribute, v: string): string {
  const t = v.trim();
  // 'TRUE' and 'true' must not become two different stored answers, or a
  // filter on "Waterproof = true" misses half the products.
  if (a.field_type === "boolean") return t.toLowerCase();
  return t;
}

/** Whatever the form sent, as a clean list of non-empty strings. */
function normalize(raw: string | string[] | undefined, _type: FieldType): string[] {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    const t = String(v).trim();
    // Duplicates collapse: the unique key on (product, attribute, value)
    // would reject the second copy anyway, and failing a save because
    // somebody ticked the same box twice is not a useful error.
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
