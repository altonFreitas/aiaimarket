"use server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { someSizeStock } from "@/lib/data/sizeStock";
import { stockKey } from "@/lib/basketKey";
import { availableInSize, sizedStock } from "@/lib/sizeStock";

/** WHAT THE SHELF HOLDS NOW, for the lines actually in somebody's basket.
 *
 * The ceiling written onto a basket line is a snapshot taken when the line
 * was added, and a basket lives in the browser for as long as the shopper
 * leaves it there. Between those two moments the shop sells things. Without
 * this, the cart's + button would enforce a number that was true last
 * Tuesday -- which is a different wrong answer from the one it used to give,
 * not a right one.
 *
 * Reads through the admin client for the same reason oneSizeStock() does:
 * product_size_stock sits on stock_movements, which carries landed unit
 * costs and which anon must never reach. What leaves this function is a
 * count per line and nothing else -- the same count the size picker on the
 * product page already shows a shopper.
 */

/** The most lines one call will price.
 *
 * A basket is a handful of things. The cap is here because this is a public
 * entry point and the alternative is letting one request ask for the stock
 * position of the entire catalogue. */
const MAX_LINES = 50;

export interface BasketLineRef {
  id: string;
  /** "" for a product not sold by size. */
  size: string;
}

/** What the catalogue says about one basket line today. */
export interface LineFacts {
  /** The ceiling. Absent means "no ceiling known" -- see below. */
  stock?: number;
  /** TODAY'S PHOTO AND LINK, not the ones copied onto the line when it was
   * added.
   *
   * This is the half that was missing. A basket line denormalises the
   * product's photo at add-time, and a basket lives in the browser for as
   * long as the shopper leaves it there -- so a product added BEFORE the
   * shop uploaded its photo kept an empty image for ever. Add the same
   * shirt again after the upload and the two lines sit side by side in the
   * cart, one with the photo and one with a grey placeholder, which is
   * exactly what was reported.
   *
   * Absent when the product row cannot be read at all; "" when the product
   * genuinely has no photo yet, which is a real answer and overwrites a
   * stale one. */
  image?: string;
  slug?: string;
}

/** Line facts keyed by `id \u0000 size`, matching what useBasket sends.
 *
 * A line whose product cannot be found, or whose shop has not counted its
 * stock, is LEFT OUT rather than returned as zero: absent means "no ceiling
 * known", and reporting an uncounted product as sold out would empty the
 * carts of every shop that has not started counting. */
export async function basketLineFacts(
  lines: BasketLineRef[]
): Promise<Record<string, LineFacts>> {
  const out: Record<string, LineFacts> = {};
  try {
    const wanted = (Array.isArray(lines) ? lines : []).slice(0, MAX_LINES);
    const ids = [...new Set(wanted.map((l) => String(l.id)).filter(Boolean))];
    if (!ids.length) return out;

    const sb = supabaseAdmin();
    const { data: products, error } = await sb
      .from("products")
      .select("id, qty, sizes, status, archived, images, slug")
      .in("id", ids);
    if (error || !products) return out;

    const byId = new Map(
      (products as Array<Record<string, unknown>>).map((p) => [String(p.id), p]));

    /* The per-size ledger, in one read for every product asked about.
       Empty on a shop that has not run supabase/size-stock.sql, which is
       why someSizeStock swallows that: those shops fall back to the
       product's own total, exactly as the size picker does. */
    const bySize = await someSizeStock(ids);

    for (const line of wanted) {
      const id = String(line.id);
      const size = String(line.size ?? "");
      const p = byId.get(id);
      /* A product that has been delisted or archived while it sat in a
         basket is nothing the shop will sell, and zero is the true
         ceiling. This is the one case where an absent product IS reported
         rather than skipped. */
      if (!p) continue;

      /* The picture and the link, whatever the product's selling state.
         A delisted product still has to LOOK like itself in a cart -- the
         shopper is being told they cannot have it, and a grey square is a
         worse way to say so than the photo they recognise. */
      const imgs = Array.isArray(p.images) ? (p.images as string[]) : [];
      const facts: LineFacts = {
        image: String(imgs.find(Boolean) || ""),
        slug: String(p.slug || ""),
      };
      out[stockKey(id, size)] = facts;

      if (p.status !== "approved" || p.archived === true) {
        /* Delisted or archived while it sat in a basket: nothing the shop
           will sell, and zero is the true ceiling. This is the one case
           where an absent product IS reported rather than skipped. */
        facts.stock = 0;
        continue;
      }

      const balances = bySize.get(id);
      const stock = balances
        ? sizedStock(balances, (p.sizes as string[] | null) ?? [])
        : null;

      if (stock?.tracked) {
        facts.stock = availableInSize(stock, size);
      } else {
        // Not counted by size: the product's own balance is the ceiling,
        // and an uncounted product is left without one rather than called
        // empty.
        const qty = Number(p.qty);
        if (Number.isFinite(qty) && qty > 0) facts.stock = qty;
      }
    }
    return out;
  } catch {
    /* A basket that cannot be re-priced keeps the ceilings it has. Failing
       loudly here would break the cart over a number that is only ever a
       courtesy. */
    return out;
  }
}
