import { validateAttributeValues, type Submitted } from "./validate";
import type { FormAttribute } from "./types";

/* WHAT A PURCHASE ORDER LINE IS ALLOWED TO SAY ABOUT A PRODUCT TYPE.
 *
 * The line carries a product type and the answers to that type's questions,
 * and receiving copies both onto the product it creates -- so this is the
 * last place either is checked before they become a listing the whole
 * internet reads. Section 25 of the brief: the category, the product type
 * and every attribute id are re-read from the database on the server and
 * never believed from the browser.
 *
 * REQUIRED IS NOT REQUIRED HERE, and that is a decision rather than an
 * omission. A product type marks Composition required because a shop
 * publishing a t-shirt should say what it is made of. A BUYER placing an
 * order at eight in the morning with the supplier on the phone may not know
 * yet -- and refusing to record the purchase until they do would mean the
 * order goes unrecorded, which is worse than a listing that has to be
 * finished later. The product form still asks for it, at the moment the
 * shop is actually publishing. So a line answers what it can.
 *
 * EVERYTHING ELSE IS STILL REFUSED, not dropped: a value that does not fit
 * its field type, and above all an attribute id the product type never
 * asked for. Dropping those would let a save look successful while losing
 * what somebody typed.
 */

export interface LineTaxonomy {
  productTypeId: string | null;
  /** attribute id -> value(s), exactly the shape the column stores and the
   * product form posts. Only what was actually answered. */
  values: Record<string, string[]>;
}

/** Thrown with a sentence naming the line, because a purchase order can
 * have twenty and "Invalid value" would not say which. */
export class LineTaxonomyError extends Error {}

/**
 * @param isResale     only goods bought to sell on ever become a product.
 * @param attrsOfType  what the product type asks for, read from the
 *                     database by the caller -- or null when there is no
 *                     such product type, which is a refusal and not an
 *                     empty list. The distinction matters: a real type with
 *                     no attributes yet is fine.
 */
export function checkLineTaxonomy(
  isResale: boolean,
  productTypeId: string | null | undefined,
  submitted: Submitted | null | undefined,
  attrsOfType: readonly FormAttribute[] | null,
  lineLabel: string,
): LineTaxonomy {
  /* An office chair the shop sits on is a real purchase and never a
     product, so it has no product type and no answers. Cleared rather than
     carried, so nothing downstream has to remember to ignore them. */
  if (!isResale) return { productTypeId: null, values: {} };

  const typeId = (productTypeId || "").trim();
  /* No type chosen is a normal state -- the shop may not use the taxonomy,
     or may not have decided. The answers go with it: they were answers to
     questions nobody is asking any more. */
  if (!typeId) return { productTypeId: null, values: {} };

  if (attrsOfType === null) {
    throw new LineTaxonomyError(
      `"${lineLabel}": that product type does not exist.`);
  }

  /* REQUIRED, RELAXED -- see the note at the top. Done by handing the
     validator a copy of the attributes with the flag cleared, rather than
     by teaching it a second mode: there is one set of rules about what a
     value may be, and this is not changing any of them. */
  const optional = attrsOfType.map((a) => ({ ...a, required: false }));
  const result = validateAttributeValues(optional, submitted ?? {});
  if (!result.ok) {
    const first = Object.values(result.errors)[0] ?? "Invalid value.";
    throw new LineTaxonomyError(`"${lineLabel}": ${first}`);
  }

  /* Rebuilt from the validated rows rather than passed through: the rows
     are canonical (a select's stored value rather than its label, a blank
     answer dropped), and storing the raw submission would let the line and
     the product disagree about the same answer. */
  const values: Record<string, string[]> = {};
  for (const r of result.rows) (values[r.attribute_id] ??= []).push(r.value);
  return { productTypeId: typeId, values };
}

/** The answers as the product form's validator wants them back.
 *
 * Stored as {id: [v, ...]} and read by receiving.ts, which hands them
 * straight to the same validator a second time -- against the same product
 * type, so it cannot fail. Kept as a named function because "the column is
 * already the right shape" is exactly the sort of thing that stops being
 * true. */
export function submittedFrom(
  stored: Record<string, string[]> | null | undefined,
  /** Only these attribute ids, when given.
   *
   * Receiving splits a line's answers in two: the variant axes go on the
   * VARIANT it creates and everything else goes on the product. Passing
   * the product's half here rather than deleting keys afterwards means the
   * validator is handed exactly what it is being asked about -- and it
   * refuses an id that is not on its list, so handing it the other half
   * would have failed the whole set. */
  only?: readonly string[]
): Submitted {
  const allowed = only ? new Set(only) : null;
  const out: Submitted = {};
  for (const [id, v] of Object.entries(stored ?? {})) {
    if (allowed && !allowed.has(id)) continue;
    if (Array.isArray(v) && v.length) out[id] = v;
  }
  return out;
}
