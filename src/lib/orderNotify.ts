import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notifyOrderEventInBackground } from "@/lib/notify/service";
import { eventForStatus } from "@/lib/notify/templates";
import type { OrderStatus } from "@/lib/types";

/** Tells the buyer their order moved, when the new status is one worth a
 * message (see eventForStatus). Shared by the admin and seller paths so a
 * seller marking their own order "out for delivery" notifies exactly as the
 * owner doing it would.
 *
 * Reads the order again rather than taking the caller's copy: the caller has
 * a two-column projection, and the message needs the buyer's name, phone,
 * total and language. One extra read per status change is a fair price for
 * not passing five fields through every call site.
 *
 * LIVES HERE, NOT IN A "use server" FILE. Every exported async function in
 * a "use server" module is a callable endpoint, and this one was exported
 * from actions/orders.ts with no guard in front of it -- so anybody at all
 * could post an order id and a status and make the shop send that buyer a
 * message, as many times as they liked. It has two callers, both of which
 * check who is asking before they get here; a plain module keeps it
 * reachable from those two and from nowhere else. */
export async function notifyStatusChange(orderId: string, status: OrderStatus) {
  const event = eventForStatus(status);
  if (!event) return;
  const sb = supabaseAdmin();
  const [{ data: order }, { data: storeRow }] = await Promise.all([
    sb.from("orders").select("id, ref, buyer_name, buyer_phone, total, lang").eq("id", orderId).maybeSingle(),
    sb.from("settings").select("store_name").eq("id", 1).maybeSingle(),
  ]);
  if (!order) return;
  notifyOrderEventInBackground(order, event, storeRow?.store_name || "Loja");
}
