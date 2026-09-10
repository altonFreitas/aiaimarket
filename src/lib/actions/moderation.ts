"use server";
import { revalidatePath } from "next/cache";
import { requireSection } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

/* TAKING A REVIEW DOWN.
 *
 * Both review tables are written by anyone who can prove a purchase --
 * an order ref plus the phone it was placed with. That proves the sale
 * happened; it proves nothing about what was then typed into the box. A
 * shop had no way at all to remove an abusive, defamatory or simply
 * mistaken review from a public product page short of opening the SQL
 * editor, which is not a thing a shopkeeper in Dili is going to do at
 * nine on a Saturday.
 *
 * DELETE, NOT HIDE. A hidden-flag would need a column on two tables, a
 * filter on every read of both, and the aggregate trigger taught about
 * it -- four places to forget. Deleting is one statement, and the
 * database already keeps the arithmetic right: the trigger in
 * supabase/marketplace-v2.sql handles DELETE and walks rating_sum and
 * rating_count back down, so a product's stars re-settle on their own.
 *
 * The row is copied into the audit trail first. Removing what a customer
 * said about a shop is exactly the kind of act that has to leave a record
 * of who did it and what it said -- otherwise "we moderate abuse" and "we
 * delete anything under four stars" look identical afterwards.
 */

export async function deleteProductReview(id: string) {
  // Catalog: a product review is a property of a product, and it is the
  // person who runs the catalog who fields the complaint about one.
  const actor = await requireSection("catalog");
  const sb = supabaseAdmin();

  // Read before delete: this is the only copy that will exist afterwards.
  const { data: row } = await sb
    .from("product_reviews")
    .select("id, product_id, buyer_name, rating, comment, created_at")
    .eq("id", id).maybeSingle();

  const { error } = await sb.from("product_reviews").delete().eq("id", id);
  if (error) throw error;

  await audit(actor, {
    action: "review.delete", entity: "product_review", entityId: id,
    summary: row
      ? `Removed a ${row.rating}-star product review by ${row.buyer_name || "somebody"}`
      : "Removed a product review that was no longer there",
    meta: { deleted: row ?? null },
  });

  // The product page, its card in every grid, and the storefront caches
  // that carry the star rating.
  revalidatePath("/admin/reviews");
  revalidatePath("/p", "layout");
  revalidatePath("/", "layout");
}

export async function deleteSellerRating(id: string) {
  // Sellers: a rating is about a store, and it is the person who manages
  // stores who answers for taking one down.
  const actor = await requireSection("sellers");
  const sb = supabaseAdmin();

  const { data: row } = await sb
    .from("seller_ratings")
    .select("id, seller_id, rating, comment, created_at")
    .eq("id", id).maybeSingle();

  const { error } = await sb.from("seller_ratings").delete().eq("id", id);
  if (error) throw error;

  await audit(actor, {
    action: "rating.delete", entity: "seller_rating", entityId: id,
    summary: row
      ? `Removed a ${row.rating}-star rating of a store`
      : "Removed a store rating that was no longer there",
    meta: { deleted: row ?? null },
  });

  // Seller ratings are averaged live from the rows (getSellerRatings), so
  // there is no denormalised counter to repair -- only pages to refresh.
  revalidatePath("/admin/reviews");
  revalidatePath("/store", "layout");
}
