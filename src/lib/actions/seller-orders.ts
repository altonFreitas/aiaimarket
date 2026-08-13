"use server";
import { requireApprovedSeller } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { FLOW } from "@/lib/utils";
import { revalidatePath } from "next/cache";
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

  if (before.status === "cancelled") {
    throw new Error("This order has been cancelled and can no longer be changed");
  }
  if (status === "cancelled") {
    if (before.status === "completed") {
      throw new Error("This order can no longer be cancelled");
    }
  } else {
    const beforeIdx = FLOW.indexOf(before.status as OrderStatus);
    const nextIdx = FLOW.indexOf(status);
    if (beforeIdx !== -1 && nextIdx !== -1 && nextIdx < beforeIdx) {
      throw new Error("Can't move an order back to an earlier status");
    }
  }

  const { error } = await sb.from("orders").update({ status }).eq("id", orderId);
  if (error) throw error;
  await sb.from("order_log").insert({
    order_id: orderId,
    text: `Estadu: ${before.status} → ${status} (${seller.store_name})`,
  });
  revalidatePath("/seller/orders");
  revalidatePath("/admin/orders");
}
