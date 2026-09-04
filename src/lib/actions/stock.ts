"use server";
import { revalidatePath, updateTag } from "next/cache";
import { requireAdmin } from "./guard";
import { audit, change } from "@/lib/audit";
import { CACHE_TAGS } from "@/lib/cache";
import { moveStockTo } from "@/lib/stockLedger";
import type { StockMovementReason } from "@/lib/types";

/* Every change to a product's stock is written as a movement, and
 * products.qty is moved by the database trigger that reads it. Nothing else
 * in the application may write products.qty.
 *
 * That rule is the whole point of supabase/stock-ledger.sql. Before it, a
 * sale went through one trigger, marking a line sold out went through an
 * UPDATE in cycleStock(), and typing a number into the product form
 * overwrote the balance outright -- so the ledger described only purchases
 * and could never answer "why does this say 7?".
 *
 * The movement itself is written by moveStockTo() in lib/stockLedger.ts,
 * which the seller actions use too. It is not exported from this file
 * because this file is "use server": everything exported from here is a
 * public endpoint, and a stock writer that checks nothing must not be one.
 * What this file adds is the part that is specific to an admin doing it --
 * the permission check, and the record of who. */

/** Writes the movement that takes a product from where it is to `nextQty`.
 * Returns the delta written, or 0 when the balance already matched. */
export async function setStock(
  productId: string, nextQty: number, note = "", reason: StockMovementReason = "adjustment"
): Promise<number> {
  const actor = await requireAdmin();

  const { from, to, delta } = await moveStockTo(productId, nextQty, note, reason);
  if (delta === 0) return 0;

  // The ledger already says WHAT moved and why. This says who moved it --
  // the one question a counted shelf cannot answer about itself.
  await audit(actor, {
    action: "stock.adjust", entity: "product", entityId: productId,
    summary: `${note || "stock adjusted"}: ${change(from, to)}`,
    meta: { from, to, delta, reason },
  });

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
