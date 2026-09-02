"use server";
import { revalidatePath, updateTag } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "./guard";
import { CACHE_TAGS } from "@/lib/cache";
import type { StockMovementReason } from "@/lib/types";

/* Every change to a product's stock is written here, as a movement, and
 * products.qty is moved by the database trigger that reads it. Nothing else
 * in the application may write products.qty.
 *
 * That rule is the whole point of supabase/stock-ledger.sql. Before it, a
 * sale went through one trigger, marking a line sold out went through an
 * UPDATE in cycleStock(), and typing a number into the product form
 * overwrote the balance outright -- so the ledger described only purchases
 * and could never answer "why does this say 7?". */

/** Writes the movement that takes a product from where it is to `nextQty`.
 * Returns the delta written, or 0 when the balance already matched.
 *
 * Takes a target rather than a delta on purpose: the admin knows what is on
 * the shelf, not the difference between the shelf and a number they cannot
 * see. Reading the current balance first also means two people counting the
 * same shelf cannot both add their count. */
export async function setStock(
  productId: string, nextQty: number, note = "", reason: StockMovementReason = "adjustment"
): Promise<number> {
  await requireAdmin();
  const sb = supabaseAdmin();

  const { data: current, error: readErr } = await sb
    .from("products").select("qty").eq("id", productId).single();
  if (readErr) throw readErr;

  const target = Math.round(Number(nextQty) || 0);
  const delta = target - Number(current.qty ?? 0);
  if (delta === 0) return 0;

  const { error } = await sb.from("stock_movements").insert({
    product_id: productId, delta, reason, note,
  });
  if (error) throw error;

  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.products);
  revalidatePath("/admin");
  revalidatePath("/admin/products");
  revalidatePath("/admin/stock");
  return delta;
}

/** The quick action on the product list: this shelf is empty.
 *
 * Only this direction. Putting a line back means saying how many, which is
 * either a purchase receipt or a count typed on the product itself -- a
 * button cannot invent the number, and the old three-way cycle did exactly
 * that, flipping a product to "in stock" while its quantity stayed at zero. */
export async function markOutOfStock(productId: string): Promise<void> {
  await setStock(productId, 0, "marked out of stock in the product list");
}
