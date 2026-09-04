import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { StockMovementReason } from "@/lib/types";

/* Moving a product's stock by writing a movement, for anyone entitled to
 * move it.
 *
 * WHY THIS IS NOT IN lib/actions/stock.ts, WHERE IT OBVIOUSLY BELONGS.
 *
 * That file is "use server". Every exported async function in a "use
 * server" file is a public HTTP endpoint -- not a function that happens to
 * run on the server, an address anybody on the internet can POST to. An
 * un-guarded stock writer exported from there would let a stranger set any
 * product to any quantity, and it would look exactly like an ordinary
 * helper while doing it. This shop has already had one hole of precisely
 * that shape.
 *
 * So the shared part lives here, in a plain server-only module that no
 * request can reach, and the two entry points do their own checking first:
 * setStock() in lib/actions/stock.ts requires an admin, and the seller
 * actions require the approved seller who owns the product. Neither can
 * forget, because neither can call this without having a caller.
 *
 * WHY IT EXISTS AT ALL.
 *
 * supabase/stock-ledger.sql makes stock_movements the only thing that ever
 * moves products.qty, and lib/actions/stock.ts states the rule: "Nothing
 * else in the application may write products.qty." The admin's product
 * form was fixed to respect it. The seller's was not -- it wrote qty and
 * stock_status straight onto the row on every save, so every seller edit
 * put the balance and its history out of step, showed up as drift in
 * stock_reconciliation, and left the restock alert comparing against a
 * reference that no longer meant anything.
 *
 * A rule that one caller keeps and another does not is not a rule. This is
 * the one implementation both of them use, and tests/stockLedger.test.ts
 * fails if a third ever writes qty on its own.
 */

/** What a movement did: where the balance was, where it is now, and the
 * difference that was written.
 *
 * Returns all three rather than just the delta so a caller can record the
 * before-and-after without reading the row a second time -- between the two
 * reads a sale could land, and the record would then describe a change that
 * never happened. */
export interface StockChange {
  from: number;
  to: number;
  /** 0 when the balance already matched and nothing was written. */
  delta: number;
}

/** Writes the movement that takes a product from where it is to `nextQty`.
 *
 * Takes a target rather than a delta on purpose: whoever is counting knows
 * what is on the shelf, not the difference between the shelf and a number
 * they cannot see. Reading the current balance first also means two people
 * counting the same shelf cannot both add their count.
 *
 * Writes nothing when the balance already matches, so saving a product form
 * without touching the quantity does not litter the ledger with zero rows.
 *
 * THE CALLER MUST HAVE ESTABLISHED WHO IS ASKING. This uses the service
 * role, which bypasses every RLS rule; it checks nothing itself.
 */
export async function moveStockTo(
  productId: string,
  nextQty: number,
  note = "",
  reason: StockMovementReason = "adjustment"
): Promise<StockChange> {
  const sb = supabaseAdmin();

  const { data: current, error: readErr } = await sb
    .from("products").select("qty").eq("id", productId).single();
  if (readErr) throw readErr;

  const from = Number(current.qty ?? 0);
  const to = Math.round(Number(nextQty) || 0);
  const delta = to - from;
  if (delta === 0) return { from, to, delta: 0 };

  const { error } = await sb.from("stock_movements").insert({
    product_id: productId, delta, reason, note,
  });
  if (error) throw error;

  // products.qty is NOT updated here. apply_stock_movement() does it, from
  // the row just inserted, and derives stock_status from the result. That
  // is the whole point: one writer, and a balance that always has a history
  // behind it.
  return { from, to, delta };
}
