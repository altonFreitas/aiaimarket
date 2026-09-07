"use server";
import { supabaseServer } from "@/lib/supabase/server";

/** Move the shop's count for one product, the same way bumpWaClickAction
 * moves the WhatsApp counter: through a SECURITY DEFINER function, so an
 * anonymous visitor can tap a heart without holding UPDATE rights on
 * products.
 *
 * NEVER THROWS. The browser has already recorded the tap locally and the
 * heart is already filled; a database that has not run supabase/loves.sql
 * yet has no such function, and failing here would turn a working control
 * into an error message about a feature the shopper did not ask for. The
 * count stays at zero until the migration runs, which is what a missing
 * column honestly means. */
export async function toggleLoveAction(productId: string, loved: boolean) {
  try {
    const sb = await supabaseServer();
    await sb.rpc(loved ? "increment_loves" : "decrement_loves", { p_id: productId });
  } catch {
    /* see above */
  }
}
