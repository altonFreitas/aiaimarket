"use server";
import { requireSection } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { attributesForType } from "@/lib/data/taxonomy";
import { validateAttributeValues, type Submitted } from "@/lib/taxonomy/validate";
import { parseSizes } from "@/lib/procurement";

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

    await syncSizes(sb, productId, attrs, result.rows);
    await syncVariants(productId, attrs, result.rows);
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

/* THE COMBINATIONS COME FROM THE ANSWERS, not from a second set of boxes.
 *
 * The form had an OPTIONS block under the fields: a Size list, a Colour
 * list and a "Create N options" button -- directly beneath the Size and
 * Colour fields the shop had just filled in with the same values. Two
 * places to say one thing, and the shop reasonably read the second as
 * noise and never pressed the button, so a product with three sizes typed
 * into it had no combinations at all.
 *
 * The answers ARE the values. "M, L, XL" in Size and "Black" in Colour is
 * three combinations, and saving makes them.
 *
 * NEVER DESTRUCTIVE. generateVariants only adds what is missing, by label
 * -- the existing rows carry SKUs, prices and, above all, stock. Taking a
 * size out of the box does not delete the variant that still has six of
 * them on a shelf; the editor lists it and the shop hides it when it is
 * gone.
 *
 * Silent about its failures on purpose: the answers are already written by
 * the time this runs, and a product whose combinations did not appear is a
 * button-press away from fixed, while a failed save is a lost one. */
async function syncVariants(
  productId: string,
  attrs: readonly { id: string; slug: string; name: string; is_variant: boolean }[],
  rows: readonly { attribute_id: string; value: string }[],
): Promise<void> {
  const axes = attrs.filter((a) => a.is_variant).map((a) => ({
    attributeId: a.id,
    name: a.name,
    /* Each answer split the way a list is read, so "M, L, XL" typed into
       one box is three values and "41,5" stays one -- the same reading the
       purchase order and the size picker give it. A multi-value field
       already arrives as several rows and simply keeps them. */
    values: rows.filter((r) => r.attribute_id === a.id)
      .flatMap((r) => parseSizes(r.value)),
  })).filter((a) => a.values.length > 0);
  if (!axes.length) return;

  try {
    const { generateVariants } = await import("./variants");
    await generateVariants({ productId, axes });
  } catch { /* the answers are written either way */ }
}

/* THE SIZE ANSWER AND THE SIZE PICKER ARE ONE FACT.
 *
 * They were two. The product type asks "Size" like any other attribute and
 * the answer went into product_attribute_values, where the product page's
 * Details block reads it. The storefront's size picker reads
 * products.sizes, which is a different column that this form stopped
 * writing -- so a shirt whose Size said "M, L, XL" offered the shopper a
 * dash, and the page said both things about itself on the same screen.
 *
 * So the answer is copied into the column the picker reads. By SLUG, and
 * `size` is the slug the ledger has used since supabase/size-stock.sql --
 * stock_movements.size, the per-size views and the reorder report all mean
 * this one. Nothing else here knows what a size is.
 *
 * Parsed with parseSizes, so "M, L, XL" typed into one box becomes three
 * sizes and "41,5" stays one -- the same reading the purchase order gives
 * it, which is what keeps the shelf and the shop agreeing.
 *
 * Silent when the type has no size attribute: most do not, and a fridge
 * must not have its sizes cleared because it was saved. */
async function syncSizes(
  sb: Sb, productId: string,
  attrs: readonly { id: string; slug: string }[],
  rows: readonly { attribute_id: string; value: string }[],
): Promise<void> {
  const size = attrs.find((a) => a.slug === "size");
  if (!size) return;
  const answered = rows.filter((r) => r.attribute_id === size.id).map((r) => r.value);
  /* Answered as nothing is an answer: a product that had sizes and no
     longer claims any should stop offering them. Not answered AT ALL --
     no row either way -- is the same thing here, because the validator
     drops a blank rather than storing it. */
  try {
    await sb.from("products")
      .update({ sizes: parseSizes(answered.join(", ")) })
      .eq("id", productId);
  } catch { /* the answers are written either way */ }
}

async function clear(sb: Sb, productId: string): Promise<void> {
  await sb.from("product_attribute_values").delete().eq("product_id", productId);
}
