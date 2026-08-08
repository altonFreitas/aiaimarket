"use server";
import { supabaseServer } from "@/lib/supabase/server";

/** E4 — click tracking on the WhatsApp order button. Calls a
 * SECURITY DEFINER function so an anonymous visitor can bump the counter
 * without holding UPDATE rights on products. */
export async function bumpWaClickAction(productId: string) {
  const sb = await supabaseServer();
  await sb.rpc("increment_wa_clicks", { p_id: productId });
}
