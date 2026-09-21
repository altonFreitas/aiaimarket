"use server";
import { requireSection } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

/* APPLYING A MIGRATION DECISION.
 *
 * One decision -- "everything in Sapatu is a Running Shoe" -- moves every
 * pending product in that category at once. That is what makes this
 * finishable: a shop with two hundred products does not have two hundred
 * decisions to make, it has as many as it has categories.
 *
 * ONLY THE PENDING ONES. A product that already has a product type is left
 * alone, always. Somebody may have set it by hand, or set it to something
 * better than the category-wide answer, and a bulk action that overwrote
 * that would destroy the careful work in favour of the quick work.
 *
 * THERE IS NO PER-PRODUCT ACTION HERE, deliberately. A product that the
 * category-wide answer gets wrong -- the one sandal among two hundred
 * running shoes -- is corrected on its own edit page, where the same
 * picker sets its type and its attributes together. A second way to do
 * the same thing is a second thing to keep right.
 *
 * NOTHING IS DELETED AND NOTHING STOPS SELLING. Setting a product type
 * adds the questions that type asks; it does not touch price, stock,
 * images, sizes or status. A product that was on sale before is on sale
 * after, with an empty specification table until somebody fills it in.
 */

export interface MigrateResult {
  moved: number;
  error?: string;
}

/** Files every product in one category under one product type.
 *
 * @param categoryId the shop's own category, or "" for the products
 *   filed under none.
 */
export async function migrateCategory(
  categoryId: string, productTypeId: string
): Promise<MigrateResult> {
  await requireSection("catalog.products");
  if (!productTypeId) return { moved: 0, error: "Choose a product type." };

  const sb = supabaseAdmin();

  /* THE TYPE IS CHECKED AGAINST THE DATABASE, not believed from the form.
     Section 25: an id that names something real but unrelated is what a
     crafted request sends, and filing two hundred products under it would
     be a large, quiet mess to undo. */
  const { data: type } = await sb
    .from("product_types").select("id").eq("id", productTypeId).maybeSingle();
  if (!type) return { moved: 0, error: "That product type does not exist." };

  try {
    let q = sb.from("products")
      .update({ product_type_id: productTypeId })
      // Pending only -- see the note at the top.
      .is("product_type_id", null);

    q = categoryId ? q.eq("category_id", categoryId) : q.is("category_id", null);

    const { data, error } = await q.select("id");
    if (error) throw error;

    revalidatePath("/admin/migrate");
    revalidatePath("/admin/products");
    return { moved: (data ?? []).length };
  } catch (e) {
    const msg = (e as { message?: string })?.message ?? "";
    if (/product_type_id|product_types/.test(msg)) {
      return { moved: 0, error: "Run supabase/run-all.sql first." };
    }
    throw e;
  }
}
