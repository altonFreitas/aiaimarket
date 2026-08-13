"use server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { phoneNorm, phoneOk } from "@/lib/utils";
import { revalidatePath } from "next/cache";

export interface SubmitRatingInput {
  ref: string;
  phone: string;
  sellerId: string;
  rating: number;
  comment: string;
}

/** Same authorization model as lookupOrder(): knowing the order's ref
 * AND the phone number it was placed with proves you're the buyer — no
 * account, no token. Beyond that, this also verifies the order is
 * actually completed and actually contains an item from this seller, so
 * a rating can never be faked for an order that didn't happen or a
 * seller who wasn't part of it. One rating per buyer per seller per
 * order (see the unique constraint in schema.sql) — resubmitting
 * updates the existing rating instead of creating a duplicate. */
export async function submitSellerRating(input: SubmitRatingInput) {
  if (!phoneOk(input.phone)) throw new Error("Invalid phone number");
  const rating = Math.round(input.rating);
  if (rating < 1 || rating > 5) throw new Error("Rating must be 1 to 5");

  const sb = supabaseAdmin();
  const { data: order } = await sb.from("orders").select("*").ilike("ref", input.ref.trim()).maybeSingle();
  if (!order) throw new Error("Order not found");
  if (order.buyer_phone !== phoneNorm(input.phone)) throw new Error("Order not found");
  if (order.status !== "completed") throw new Error("This order isn't completed yet");

  const hasSellerItem = (order.items || []).some(
    (i: { seller_id: string | null }) => i.seller_id === input.sellerId
  );
  if (!hasSellerItem) throw new Error("This seller wasn't part of that order");

  const { error } = await sb.from("seller_ratings").upsert(
    {
      seller_id: input.sellerId,
      order_id: order.id,
      buyer_phone: order.buyer_phone,
      rating,
      comment: input.comment.trim(),
    },
    { onConflict: "order_id,seller_id" }
  );
  if (error) throw error;

  revalidatePath("/store", "layout");
}
