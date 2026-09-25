import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sizedStock, type SizeBalance, type SizedStock } from "@/lib/sizeStock";

/* READING product_size_stock.
 *
 * ITS OWN FILE, and the reason is a test rather than tidiness.
 * tests/stockLedger.test.ts enforces the rule that nothing outside the
 * ledger writes products.qty, and it does that by flagging any `qty:` in an
 * object literal inside a file that also queries the products table. These
 * two functions build { size, qty } rows -- reads of a view, not writes of
 * anything -- and living in data/admin.ts they read to that scanner exactly
 * like the bug it exists to catch.
 *
 * Weakening the scanner to let them through would blunt it for the case it
 * was written for. Nothing here touches the products table, so nothing here
 * is scanned, and the rule keeps its teeth.
 *
 * Both degrade to nothing rather than throwing when supabase/size-stock.sql
 * has not been run: every caller then behaves exactly as it did before
 * sizes existed.
 */

const MAX_ROWS = 20_000;

/** Every product's per-size balance, keyed by product id.
 *
 * One read of the whole view rather than one per product: the stock screen
 * and the admin home both want the picture for the entire catalogue, and a
 * query per product is how a catalogue of two hundred becomes a page that
 * times out. */
export async function allSizeStock(): Promise<Map<string, SizeBalance[]>> {
  const out = new Map<string, SizeBalance[]>();
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("product_size_stock").select("product_id, size, qty").limit(MAX_ROWS);
    if (error || !data) return out;
    for (const r of data as Array<Record<string, unknown>>) {
      const id = String(r.product_id);
      const rows = out.get(id) ?? [];
      rows.push({ size: String(r.size ?? ""), qty: Number(r.qty) || 0 });
      out.set(id, rows);
    }
  } catch { /* migration not run */ }
  return out;
}

/** Per-size balances for a named handful of products.
 *
 * allSizeStock() above reads the whole view, which is right for the screens
 * that want the entire catalogue and wrong for a basket of four things.
 * Same shaping, same "absent means not counted" rule, one `in` filter.
 *
 * It also keeps that shaping in THIS file. A copy of it grew in the basket
 * action, which reads the products table as well -- and the ledger guard in
 * tests/stockLedger.test.ts flagged the `qty:` it wrote, correctly: a file
 * that touches products and assigns qty is exactly the shape of the bug
 * that guard exists for. The shaping belongs here, where nothing writes
 * stock. */
export async function someSizeStock(
  productIds: readonly string[]
): Promise<Map<string, SizeBalance[]>> {
  const out = new Map<string, SizeBalance[]>();
  if (!productIds.length) return out;
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("product_size_stock").select("product_id, size, qty")
      .in("product_id", productIds as string[]).limit(MAX_ROWS);
    if (error || !data) return out;
    for (const r of data as Array<Record<string, unknown>>) {
      const id = String(r.product_id);
      const rows = out.get(id) ?? [];
      rows.push({ size: String(r.size ?? ""), qty: Number(r.qty) || 0 });
      out.set(id, rows);
    }
  } catch { /* migration not run */ }
  return out;
}

/** One product's picture, for the product page.
 *
 * Read through the admin client because product_size_stock sits on
 * stock_movements, which anon has no access to and must not: the ledger
 * carries landed unit costs, which is the shop's margin. The page sends
 * only the counts, which is all a shopper needs and all they get.
 *
 * Null -- never an empty breakdown -- when the migration has not been run
 * or the read fails, so the size picker behaves exactly as it always did
 * rather than showing every size as sold out on a full shelf. */
export async function oneSizeStock(
  productId: string, sizes: readonly string[]
): Promise<SizedStock | null> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("product_size_stock").select("size, qty").eq("product_id", productId);
    if (error || !data) return null;
    return sizedStock(
      (data as Array<Record<string, unknown>>).map((r) => ({
        size: String(r.size ?? ""), qty: Number(r.qty) || 0,
      })),
      sizes
    );
  } catch {
    return null;
  }
}
