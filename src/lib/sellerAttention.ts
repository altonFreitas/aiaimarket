/* What one store has waiting for it today.
 *
 * The owner's version of this (lib/attention.ts) reads the whole
 * marketplace and links into /admin. A seller needs the same question
 * answered about their own shelf, and NOT the same answers: half the
 * owner's list is about money moving between the platform and its
 * suppliers, and every href on it goes somewhere a seller cannot open.
 *
 * So this is its own builder, emitting the same AttentionItem shape into
 * the same markup. Four things, and each one is either work the seller can
 * do or a fact they are owed:
 *
 *   my_orders_new        somebody bought and has heard nothing back
 *   my_products_pending  waiting on the MARKETPLACE, not on them -- which
 *                        is why it is info and not a task
 *   my_out_of_stock      listed, findable, and unbuyable
 *   my_restock_soon      still selling, running down
 *
 * Pure: no I/O, no session, nothing that needs a database to test.
 */
import { restockAlerts, normalizeRestockPct, type RestockInput } from "./restock";
import type { AttentionItem } from "./attention";
import type { Product } from "./types";

export interface SellerAttentionInput {
  /** This store's orders, as /seller/orders sees them. */
  orders: readonly { status: string }[];
  /** This store's products, archived ones included -- filtered here. */
  products: readonly Product[];
  /** The marketplace's restock threshold, so a seller and the owner are
   * looking at the same definition of "running low". */
  restockPct?: number;
}

const RANK = { urgent: 0, warn: 1, info: 2 } as const;

export function buildSellerAttention(input: SellerAttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const add = (
    kind: AttentionItem["kind"], count: number, severity: AttentionItem["severity"],
    href: string, labelKey: string, hintKey: string,
    vars?: Record<string, string | number>
  ) => { if (count > 0) items.push({ kind, count, severity, href, labelKey, hintKey, vars }); };

  const live = input.products.filter((p) => !p.archived);

  // Somebody has bought and nobody has answered them. The only thing on
  // this list where a person is already waiting.
  add("my_orders_new", input.orders.filter((o) => o.status === "new").length, "urgent",
    "/seller/orders", "attnMyOrdersNew", "attnMyOrdersNewHint");

  // Unbuyable, and still on the shop. Urgent for the same reason the
  // owner's version is: the listing is still being found.
  add("my_out_of_stock", live.filter((p) => p.stock_status === "out").length, "urgent",
    "/seller/products", "attnMyOutOfStock", "attnMyOutOfStockHint");

  const pct = normalizeRestockPct(input.restockPct);
  add("my_restock_soon", restockAlerts(live as readonly RestockInput[], pct).length, "warn",
    "/seller/products", "restockSoon", "attnMyRestockSoonHint", { pct });

  // INFO, NOT A TASK. There is nothing for the seller to do here but wait
  // -- approving a listing is the marketplace's job -- and putting it on a
  // to-do list as work would be asking somebody to act on something they
  // cannot. It is here because "why is my product not showing" is the
  // question it answers.
  add("my_products_pending", live.filter((p) => p.status === "pending").length, "info",
    "/seller/products", "attnMyProductsPending", "attnMyProductsPendingHint");

  return items.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}
