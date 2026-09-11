"use server";
import { requireApprovedSeller } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertOrderTransition } from "@/lib/orderFlow";
import { notifyStatusChange } from "@/lib/orderNotify";
import { revalidatePath } from "next/cache";
import { assertFulfilmentTransition, type FulfilmentStatus } from "@/lib/fulfilment";
import type { OrderItem, OrderStatus } from "@/lib/types";

/** Same forward-only rules as the admin's setOrderStatus() in
 * lib/actions/orders.ts (mirrored exactly, not reimplemented from
 * scratch), plus one extra check that only matters for a seller: every
 * item in the order must belong to THIS seller. order.status is a
 * single column shared by the whole order, so a seller changing it on
 * an order that also contains another seller's (or the platform's own)
 * items would silently mis-state that other party's fulfillment status
 * — there's no per-seller status column in this schema. A mixed-seller
 * order is therefore read-only for sellers; only a genuinely
 * single-seller order can have its status changed here. */
export async function setOrderStatusAsSeller(orderId: string, status: OrderStatus) {
  const seller = await requireApprovedSeller();
  const sb = supabaseAdmin();
  const { data: before } = await sb.from("orders").select("status, ref, items, mode").eq("id", orderId).single();
  if (!before) throw new Error("Order not found");

  const items = (before.items || []) as OrderItem[];
  const allMine = items.length > 0 && items.every((i) => i.seller_id === seller.id);
  if (!allMine) throw new Error("This order includes items from another seller — status is managed by the store");

  // Identical rules to the admin path, because they are literally the same
  // function now -- see lib/orderFlow.ts.
  assertOrderTransition(before.status as OrderStatus, status);

  const { error } = await sb.from("orders").update({ status }).eq("id", orderId);
  if (error) throw error;
  await sb.from("order_log").insert({
    order_id: orderId,
    text: `Estadu: ${before.status} → ${status} (${seller.store_name})`,
  });
  // Same notification the admin path sends -- a buyer should not get a
  // different experience depending on who moved their order.
  await notifyStatusChange(orderId, status);
  revalidatePath("/seller/orders");
  revalidatePath("/admin/orders");
}

/* MOVING YOUR OWN HALF OF A MIXED ORDER.
 *
 * setOrderStatusAsSeller() above still refuses a mixed-seller order, and
 * still should: orders.status is one column shared by everybody in it, so
 * a seller moving it would be speaking for the other seller too.
 *
 * This is the other half of that answer. Each seller's LINES carry their
 * own fulfilment status (see supabase/order-items.sql), so a seller can
 * say "mine is packed and gone" without touching anybody else's -- which
 * is what ends the read-only mixed order and, with it, the ceiling on the
 * multi-vendor claim.
 *
 * The buyer still gets one answer to "where is my order", derived from the
 * slowest line. See suggestedOrderStatus() in lib/fulfilment.ts.
 */
export async function setLineFulfilmentAsSeller(
  orderItemId: string, status: FulfilmentStatus,
) {
  const seller = await requireApprovedSeller();
  const sb = supabaseAdmin();

  // OWNERSHIP FIRST, and read from the row rather than trusted from the
  // request. An id is not a claim to the thing it names.
  const { data: line, error: readErr } = await sb
    .from("order_items")
    .select("id, order_id, seller_id, name, fulfilment_status")
    .eq("id", orderItemId)
    .maybeSingle();
  if (readErr || !line) throw new Error("That line no longer exists");
  if (line.seller_id !== seller.id) {
    // Deliberately the same sentence as a line that does not exist. A
    // different one would answer "does this id belong to somebody else",
    // which is not a question a seller gets to ask.
    throw new Error("That line no longer exists");
  }

  assertFulfilmentTransition(
    line.fulfilment_status as FulfilmentStatus, status);

  const { error } = await sb
    .from("order_items")
    .update({ fulfilment_status: status })
    .eq("id", orderItemId)
    // Belt and braces: the ownership check above is the gate, and this
    // makes the WRITE itself impossible to aim at somebody else's row even
    // if that check were ever refactored away.
    .eq("seller_id", seller.id);
  if (error) throw error;

  await sb.from("order_log").insert({
    order_id: line.order_id,
    text: `${line.name}: ${line.fulfilment_status} → ${status} (${seller.store_name})`,
  });

  revalidatePath("/seller/orders");
  revalidatePath("/admin/orders");
}
