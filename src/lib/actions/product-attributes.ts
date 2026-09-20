"use server";
import { requireSection } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { attributesForType } from "@/lib/data/taxonomy";
import { validateAttributeValues, type Submitted } from "@/lib/taxonomy/validate";

/* WRITING A PRODUCT'S ANSWERS.
 *
 * Separate from saveProduct() rather than folded into it, for a reason
 * that is not tidiness: the universal fields (name, price, stock) are
 * written by an action that has worked for a year, and the migration
 * window this project deploys through means product_attribute_values may
 * not exist yet when this code ships. Keeping them apart means a shop that
 * has not pasted the SQL still saves products exactly as before, and gets
 * the attributes the moment it does.
 *
 * THE ORDER OF CHECKS IS THE SECURITY. Nothing the browser sent is
 * believed:
 *
 *   1. the caller may edit the catalogue at all;
 *   2. the product type is real, and the attributes are read FROM IT --
 *      not from the payload, so the payload cannot introduce one;
 *   3. every posted attribute belongs to that product type, every value
 *      fits its field type and rules (lib/taxonomy/validate.ts);
 *   4. only then does anything reach the database.
 *
 * REPLACE, NOT MERGE. A save writes the whole answer set for the product:
 * rows for attributes no longer answered are deleted. Merging would leave
 * a sofa holding a Seat Height it no longer claims, and no screen would
 * ever show it again to explain why a filter kept finding it.
 */

export interface SaveAttributesInput {
  productId: string;
  productTypeId: string;
  /** attribute id -> value or values, straight from the form. */
  values: Submitted;
}

export interface SaveAttributesResult {
  ok: boolean;
  /** attribute id -> what is wrong, for the form to show in place. */
  errors: Record<string, string>;
}

export async function saveProductAttributes(
  input: SaveAttributesInput
): Promise<SaveAttributesResult> {
  await requireSection("catalog.products");

  const { productId, productTypeId } = input;
  if (!productId) return { ok: false, errors: { _: "No product." } };

  const sb = supabaseAdmin();

  /* A product with no type carries no dynamic attributes -- which is the
     state every product created before this existed is in. Clearing and
     returning is the honest handling: it is not an error, and it also
     means changing a product back to "no type" removes its old answers
     rather than orphaning them. */
  if (!productTypeId) {
    await clear(sb, productId);
    await sb.from("products").update({ product_type_id: null }).eq("id", productId);
    return { ok: true, errors: {} };
  }

  /* THE ATTRIBUTES COME FROM THE PRODUCT TYPE, NEVER FROM THE PAYLOAD.
     This is what makes step 3 meaningful: the validator compares what was
     posted against this list, so an id the type does not ask for has
     nothing to match. An unknown or empty product type therefore yields an
     empty list and every posted value is refused, which is the correct
     answer to "save these attributes against a type that does not exist". */
  const attrs = await attributesForType(productTypeId, { includeAdminOnly: true });
  if (!attrs.length && Object.keys(input.values).length) {
    return { ok: false, errors: { _: "That product type has no fields." } };
  }

  const result = validateAttributeValues(attrs, input.values);
  if (!result.ok) return { ok: false, errors: result.errors };

  /* The write. Delete-then-insert rather than an upsert per row: it is one
     round trip each way, it removes what is no longer answered, and it
     cannot leave a half-updated answer set behind the way a sequence of
     per-row upserts could. */
  try {
    await sb.from("products")
      .update({ product_type_id: productTypeId })
      .eq("id", productId);

    await clear(sb, productId);

    if (result.rows.length) {
      const { error } = await sb.from("product_attribute_values").insert(
        result.rows.map((r) => ({ product_id: productId, ...r })));
      if (error) throw error;
    }
    return { ok: true, errors: {} };
  } catch (e) {
    /* The migration window: the table is not there yet. The universal
       fields have already saved by this point, so the product exists and
       is sellable -- saying the attributes did not stick is more useful
       than failing the whole save and implying nothing was kept. */
    const msg = (e as { message?: string })?.message ?? "";
    if (/product_attribute_values/.test(msg)) {
      return { ok: false, errors: {
        _: "Product saved, but the attribute tables are not installed yet. " +
           "Run supabase/run-all.sql.",
      } };
    }
    throw e;
  }
}

type Sb = ReturnType<typeof supabaseAdmin>;

async function clear(sb: Sb, productId: string): Promise<void> {
  await sb.from("product_attribute_values").delete().eq("product_id", productId);
}
