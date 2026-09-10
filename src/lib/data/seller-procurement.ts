import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { PurchaseOrder, Supplier } from "@/lib/types";

/* One store's own buying.
 *
 * Read with the service role and filtered by seller_id here, in one place,
 * because suppliers and purchase_orders have RLS on with no policy for a
 * logged-in seller at all (see supabase/procurement.sql) -- the database
 * will not hand a seller their own rows, so the filter in this file IS the
 * boundary. Every caller has already passed requireSellerFeature.
 *
 * Caps are a tenth of the owner's: a store's purchasing book is its own,
 * not the marketplace's, and a seller with two thousand suppliers is a
 * question rather than a page to render.
 */
const MAX_POS = 500;
const MAX_SUPPLIERS = 200;

/** False until supabase/seller-procurement.sql has been run.
 *
 * Probed rather than assumed, and reported rather than swallowed: without
 * the column every read below fails, and returning an empty list would tell
 * a seller they have no purchase orders when the truth is that the feature
 * has not been installed. */
export async function sellerProcurementReady(): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin()
      .from("purchase_orders").select("seller_id").limit(1);
    return !error;
  } catch { return false; }
}

export async function getSellerSuppliers(sellerId: string): Promise<Supplier[]> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("suppliers").select("*")
      .eq("seller_id", sellerId)
      .order("name").limit(MAX_SUPPLIERS);
    if (error) return [];
    return (data as Supplier[]) || [];
  } catch { return []; }
}

export async function getSellerPurchaseOrders(sellerId: string): Promise<PurchaseOrder[]> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("purchase_orders")
      .select("*, items:purchase_order_items(*)")
      .eq("seller_id", sellerId)
      .order("order_date", { ascending: false })
      .limit(MAX_POS);
    if (error) return [];
    return (data as PurchaseOrder[]) || [];
  } catch { return []; }
}

/** One order, and only if it is this store's.
 *
 * The id comes out of a URL, so the ownership check is the point of the
 * function -- not the fetch. */
export async function getSellerPurchaseOrder(
  sellerId: string, id: string
): Promise<PurchaseOrder | null> {
  try {
    const { data } = await supabaseAdmin()
      .from("purchase_orders")
      .select("*, items:purchase_order_items(*)")
      .eq("id", id).eq("seller_id", sellerId)
      .maybeSingle();
    return (data as PurchaseOrder) || null;
  } catch { return null; }
}
