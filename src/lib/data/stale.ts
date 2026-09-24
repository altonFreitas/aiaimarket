import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { staleProducts, normalizeStaleDays, type StaleProduct } from "@/lib/stale";

/* WHICH PRODUCTS HAVE NOT SOLD, read from the books rather than guessed.
 *
 * WHY NOT FROM THE ORDER LIST THE ADMIN ALREADY HAS. Every other figure on
 * the to-do list is built from adminOrdersCapped(), which reads the most
 * recent N orders -- and a cap is exactly what this question cannot
 * tolerate. A busy shop's cap covers three weeks, so a product that sold
 * twenty-eight days ago would be missing from that list and reported as
 * not having sold in thirty. The alert would fire hardest on the shop it
 * is least true of.
 *
 * So the window is asked for directly: every order line since the cutoff,
 * product ids only. That is one indexed read of a narrow column, and its
 * size is bounded by the window rather than by the catalogue.
 *
 * A CANCELLED ORDER IS NOT A SALE, and nothing else is excluded. Waiting
 * to be confirmed, being packed, out for delivery -- all of those are
 * somebody buying the thing, and a product with an order in flight is not
 * sitting on a shelf being ignored.
 */

/** Products already on offer are left out.
 *
 * The shop has looked at them and acted; telling it again every morning is
 * how a notice stops being read. One whose discount has not worked is a
 * different decision -- a deeper cut, a bundle, sending it back -- and not
 * one this list can make. */
export interface StaleReport {
  products: StaleProduct[];
  /** The limit actually applied, after clamping. Shown, so the shop can
   * see which number produced the list. */
  days: number;
}

export async function staleStock(days: number): Promise<StaleReport> {
  const limit = normalizeStaleDays(days);
  const empty: StaleReport = { products: [], days: limit };

  try {
    const sb = supabaseAdmin();
    const since = new Date(Date.now() - limit * 86_400_000).toISOString();

    /* THE SHELF: listed, approved, in stock and not already discounted.
       Discounting something the shop has run out of achieves nothing, and
       an unapproved or archived product is not on sale to begin with. */
    const { data: rows, error } = await sb
      .from("products")
      .select("id, name, created_at, stock_status, archived, status, discount_price")
      .eq("archived", false)
      .eq("status", "approved")
      .neq("stock_status", "out")
      .is("discount_price", null);
    if (error || !rows) return empty;

    const candidates = (rows as {
      id: string; name: string; created_at: string;
    }[]).map((r) => ({
      id: r.id, name: r.name, createdAt: r.created_at, lastSoldAt: null as string | null,
    }));
    if (!candidates.length) return empty;

    /* WHAT SOLD INSIDE THE WINDOW. Only the ids are needed: anything that
       appears here is not stale, and how much of it sold is a question for
       the sales dashboard. */
    const sold = new Set<string>();
    const { data: lines } = await sb
      .from("order_items")
      .select("product_id, orders!inner(status)")
      .neq("orders.status", "cancelled")
      .gte("created_at", since);
    for (const l of (lines ?? []) as { product_id: string | null }[]) {
      if (l.product_id) sold.add(l.product_id);
    }

    /* A SALE INSIDE THE WINDOW IS RECORDED AS "TODAY", not as its real
       date, and that is all this needs: the only thing the rule asks is
       whether the last sale is older than the limit, and every id in this
       set is by construction newer. Reading the exact dates would be a
       second, larger query answering a question nobody asked. */
    const now = new Date().toISOString();
    for (const c of candidates) if (sold.has(c.id)) c.lastSoldAt = now;

    return { products: staleProducts(candidates, limit, Date.now()), days: limit };
  } catch {
    /* No order_items table yet, or no products table reachable. A shop
       without this notice is the shop as it was; an error page is not. */
    return empty;
  }
}
