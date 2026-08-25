"use server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { phoneNorm, phoneOk } from "@/lib/utils";
import { rateLimit, callerKey } from "@/lib/rateLimit";
import { CACHE_TAGS } from "@/lib/cache";
import { updateTag, revalidatePath } from "next/cache";
import type { OrderItem } from "@/lib/types";

const MAX_COMMENT_LEN = 1000;

export interface SubmitProductReviewInput {
  ref: string;
  phone: string;
  productId: string;
  rating: number;
  comment: string;
}

/** A product review, authorized exactly the way submitSellerRating() and
 * lookupOrder() already are: the order's reference plus the phone number it
 * was placed with is proof of purchase. No account, no emailed token.
 *
 * Three checks make this a *verified* review rather than an opinion box:
 *   1. the order exists and the phone matches it,
 *   2. the order actually reached "completed" — a review for something not
 *      yet delivered is not evidence of anything,
 *   3. the order genuinely contained this product.
 *
 * One review per product per order (unique constraint in
 * marketplace-v2.sql); resubmitting edits the buyer's existing review rather
 * than stacking a second one. The star average on the product is maintained
 * by a database trigger, not recomputed here, so it cannot drift from the
 * rows it summarises. */
export async function submitProductReview(input: SubmitProductReviewInput) {
  if (!phoneOk(input.phone)) throw new Error("Invalid phone number");
  const rating = Math.round(Number(input.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw new Error("Rating must be 1 to 5");
  }

  // Writing a review is unauthenticated in the same sense guest checkout is:
  // proof is a ref + phone, both of which a determined script could grind at.
  // The throttle does not change the trust model, it just prices the attempt.
  const limit = rateLimit(await callerKey("product-review"), 20, 600);
  if (!limit.allowed) {
    throw new Error(`Too many reviews from this connection. Try again in ${limit.retryAfterSeconds}s.`);
  }

  const sb = supabaseAdmin();
  const { data: order } = await sb
    .from("orders")
    .select("id, buyer_phone, buyer_name, status, items")
    .eq("ref", input.ref.trim().toUpperCase())
    .maybeSingle();

  // Deliberately the same message for "no such order" and "wrong phone":
  // distinguishing them turns this into an oracle for which references exist.
  if (!order) throw new Error("Order not found");
  if (order.buyer_phone !== phoneNorm(input.phone)) throw new Error("Order not found");
  if (order.status !== "completed") throw new Error("This order isn't completed yet");

  const bought = ((order.items || []) as OrderItem[]).some((i) => i.product_id === input.productId);
  if (!bought) throw new Error("That product wasn't in this order");

  const { error } = await sb.from("product_reviews").upsert(
    {
      product_id: input.productId,
      order_id: order.id,
      buyer_phone: order.buyer_phone,
      // Shown publicly, so it is the name the buyer already gave at
      // checkout — never the phone number, which stays server-side.
      buyer_name: (order.buyer_name || "").slice(0, 120),
      rating,
      comment: (input.comment || "").trim().slice(0, MAX_COMMENT_LEN),
    },
    { onConflict: "order_id,product_id" }
  );
  if (error) throw error;

  // The star average lives on the product row, which the catalog cache
  // holds — so a new review has to invalidate the catalog, not just the
  // product page.
  updateTag(CACHE_TAGS.products);
  revalidatePath("/p", "layout");
}
