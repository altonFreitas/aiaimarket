"use server";
import { requireAdmin } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { phoneNorm, phoneOk, FLOW } from "@/lib/utils";
import { revalidatePath } from "next/cache";
import type { OrderItem, OrderLogEntry, OrderStatus, PayMethod, PayStatus, Zone } from "@/lib/types";

/** Shared collision-checked reference generator: prefix + year +
 * last4(phone) + 6 random digits. Used for both delivery and pickup
 * refs (they only differ in prefix). Collision odds are astronomically
 * small (1 in a million per attempt before even considering phone/year),
 * but we still check and retry — `ref` is UNIQUE in the database, so an
 * unlucky collision must never surface as a raw insert error to the
 * buyer. */
async function nextRefWithPrefix(prefix: string, normalizedPhone: string): Promise<string> {
  const sb = supabaseAdmin();
  const year = new Date().getFullYear();
  const phoneDigits = normalizedPhone.replace(/[^\d]/g, "");
  const last4 = phoneDigits.slice(-4).padStart(4, "0");

  for (let attempt = 0; attempt < 5; attempt++) {
    const rand = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    const ref = `${prefix}${year}${last4}${rand}`;
    const { data } = await sb.from("orders").select("id").eq("ref", ref).maybeSingle();
    if (!data) return ref;
  }
  throw new Error("Could not generate a unique order reference — please try again");
}

/** Delivery orders get a zone-coded prefix the customer can recognise at
 * a glance, and that already carries the info a courier needs:
 *   Central Dili         → CD
 *   Dili outskirts        → DO
 *   Other municipality    → OM + first 2 letters of municipality
 * Pickup orders (no courier, no zone) use PP instead. */
function deliveryPrefix(zoneId: string, municipality?: string): string {
  if (zoneId === "dili_center") return "CD";
  if (zoneId === "dili_outskirts") return "DO";
  const letters = (municipality || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2).padEnd(2, "X");
  return "OM" + letters;
}

export interface PlaceOrderInput {
  name: string;
  phone: string;
  items: Omit<OrderItem, "seller_id">[];
  mode: "delivery" | "pickup";
  zoneId?: string;
  addressLine?: string; // Central Dili: a simple street address
  municipality?: string; post?: string; suku?: string; aldeia?: string; landmark?: string;
  payMethod: PayMethod;
  note?: string;
}

/** F1/F2 — guest checkout, no account. Uses the ANON client (not admin):
 * RLS explicitly allows public INSERT on orders and nothing else, so this
 * is safe to call from a client action without extra guarding. */
export async function placeOrder(input: PlaceOrderInput) {
  if (!input.name.trim()) throw new Error("Name is required");
  if (!phoneOk(input.phone)) throw new Error("Invalid phone number");
  if (!input.items.length) throw new Error("Basket is empty");

  // Fee + zone resolution happens server-side against real settings,
  // never trusted from the client.
  const sb = supabaseAdmin(); // service role: needed to read settings.zones reliably & to insert with computed ref
  const { data: settings } = await sb.from("settings").select("zones").eq("id", 1).single();
  const zones = (settings?.zones as Zone[]) || [];
  const zone = input.mode === "delivery" ? zones.find((z) => z.id === input.zoneId) : null;
  let fee = zone && !zone.quote ? Number(zone.fee) : 0;
  const subtotal = input.items.reduce((a, i) => a + i.price * i.qty, 0);
  const normalizedPhone = phoneNorm(input.phone);

  // Resolve each item's seller_id server-side, never from the client --
  // this is what makes it possible to later show a seller only their own
  // items in a mixed-cart order, and to compute their earnings. A
  // product with no real seller (still just the platform owner's own
  // catalog) resolves to whatever seller_id the products row already
  // has by default, same as everywhere else in the schema.
  const productIds = [...new Set(input.items.map((i) => i.product_id))];
  const { data: prodRows } = await sb.from("products").select("id, seller_id").in("id", productIds);
  const sellerByProduct = new Map((prodRows || []).map((row) => [row.id, row.seller_id as string | null]));
  const itemsWithSeller: OrderItem[] = input.items.map((i) => ({
    ...i,
    seller_id: sellerByProduct.get(i.product_id) ?? null,
  }));

  // Seller-configured delivery fee: if every item in this order belongs
  // to the SAME real seller (not a mixed cart, not the platform's own
  // catalog) and that seller has set their own delivery_fee, use it
  // instead of the platform's zone-based fee. A mixed-seller cart, or
  // one made entirely of the platform's own products, keeps using the
  // existing zone-based calculation exactly as before -- unchanged
  // behavior for every case that exists in this store today.
  if (input.mode === "delivery") {
    const distinctSellerIds = new Set(itemsWithSeller.map((i) => i.seller_id).filter(Boolean));
    if (distinctSellerIds.size === 1) {
      const [onlySellerId] = distinctSellerIds;
      const { data: sellerRow } = await sb
        .from("sellers").select("delivery_fee").eq("id", onlySellerId).maybeSingle();
      if (sellerRow?.delivery_fee != null) {
        fee = Number(sellerRow.delivery_fee);
      }
    }
  }

  const ref = input.mode === "delivery"
    ? await nextRefWithPrefix(deliveryPrefix(input.zoneId || "", input.municipality), normalizedPhone)
    : await nextRefWithPrefix("PP", normalizedPhone);

  const { data, error } = await sb
    .from("orders")
    .insert({
      ref,
      buyer_name: input.name.trim(),
      buyer_phone: normalizedPhone,
      items: itemsWithSeller,
      mode: input.mode,
      zone_id: input.mode === "delivery" ? input.zoneId : null,
      fee,
      quote_requested: !!(zone && zone.quote),
      subtotal,
      total: subtotal + fee,
      address_line: input.mode === "delivery" ? input.addressLine || null : null,
      municipality: input.mode === "delivery" ? input.municipality || null : null,
      post: input.mode === "delivery" ? input.post || null : null,
      suku: input.mode === "delivery" ? input.suku || null : null,
      aldeia: input.mode === "delivery" ? input.aldeia || null : null,
      landmark: input.mode === "delivery" ? input.landmark : null,
      pay_method: input.payMethod,
      pay_status: "unpaid",
      note: input.note || "",
      status: "new",
    })
    .select()
    .single();
  if (error) throw error;

  await sb.from("order_log").insert({
    order_id: data.id,
    text: `Enkomenda simu (${input.mode === "delivery" ? "entrega" : "foti rasik"})`,
  });

  revalidatePath("/admin/orders");
  return data.ref as string;
}

/** I — order lookup gate: reference + phone, no password. Runs with the
 * service-role key ONLY inside this server action, and only ever returns
 * data when the phone matches — the browser never gets a raw admin key
 * or an unauthenticated SELECT on the orders table. */
export async function lookupOrder(ref: string, phone: string) {
  if (!phoneOk(phone)) return null;
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("orders")
    .select("*, order_log(*)")
    .ilike("ref", ref.trim())
    .maybeSingle();
  if (!data) return null;
  if (data.buyer_phone !== phoneNorm(phone)) return null;
  data.order_log?.sort((a: OrderLogEntry, b: OrderLogEntry) => a.id - b.id);
  return data;
}

/** "My Orders" — knowing the phone number alone reveals every order made
 * with it, no code or password. This is intentionally the same trust
 * level as guest checkout already uses (the spec's Decision 3: phone
 * number is the identity), just widened from one order to all of them —
 * no new accounts table, no SMS provider, no added cost. */
export async function getOrdersByPhone(phone: string) {
  if (!phoneOk(phone)) return [];
  const sb = supabaseAdmin();
  const normalized = phoneNorm(phone);
  const { data } = await sb
    .from("orders")
    .select("ref, buyer_name, buyer_phone, status, pay_status, total, created_at, mode")
    .eq("buyer_phone", normalized)
    .order("created_at", { ascending: false });
  return data || [];
}

/** I7 — buyer-initiated cancellation request; still gated by ref+phone. */
export async function requestCancellation(ref: string, phone: string, reason: string) {
  const order = await lookupOrder(ref, phone);
  if (!order) throw new Error("Order not found");
  if (!["new", "confirmed"].includes(order.status)) throw new Error("Too late to cancel");
  const sb = supabaseAdmin();
  await sb
    .from("orders")
    .update({ cancel_reason: reason, cancel_requested_at: new Date().toISOString() })
    .eq("id", order.id);
  await sb.from("order_log").insert({ order_id: order.id, text: `Kliente husu kansela: ${reason}` });
  revalidatePath("/admin/orders");
}

/** I4 — buyer can edit the delivery address up until "out for delivery". */
export async function updateOrderAddress(
  ref: string, phone: string,
  addr: { address_line?: string; municipality?: string; post?: string; suku?: string; aldeia?: string; landmark: string }
) {
  const order = await lookupOrder(ref, phone);
  if (!order) throw new Error("Order not found");
  if (["out", "arrived", "completed", "cancelled"].includes(order.status)) {
    throw new Error("Address is locked");
  }
  const sb = supabaseAdmin();
  await sb.from("orders").update(addr).eq("id", order.id);
  await sb.from("order_log").insert({ order_id: order.id, text: "Kliente troka fatin entrega" });
  revalidatePath("/admin/orders");
}

/** G3 — buyer uploads a payment-proof screenshot (compressed client-side). */
export async function uploadPaymentProof(ref: string, phone: string, dataUrl: string) {
  const order = await lookupOrder(ref, phone);
  if (!order) throw new Error("Order not found");
  const sb = supabaseAdmin();
  const base64 = dataUrl.split(",")[1];
  const bytes = Buffer.from(base64, "base64");
  const path = `proofs/${order.ref}-${Date.now()}.webp`;
  const { error } = await sb.storage.from("payment-proofs").upload(path, bytes, {
    contentType: "image/webp",
  });
  if (error) throw error;
  const { data: signed } = await sb.storage.from("payment-proofs").createSignedUrl(path, 60 * 60 * 24 * 365);
  await sb.from("orders").update({ proof_url: signed?.signedUrl }).eq("id", order.id);
  await sb.from("order_log").insert({ order_id: order.id, text: "Kliente karga komprovante pagamentu" });
  revalidatePath("/admin/orders");
}

// ---------------------------- admin-only ----------------------------

/** F4 — status machine, including the F5 stock-decrement trigger in Postgres.
 * Forward-only: once an order has moved to a later step, it can't be sent
 * back to an earlier one, and it can't be cancelled once completed (or
 * cancelled again once already cancelled). Enforced here, not just in the
 * UI, so a stray/replayed request can't sneak an order backwards. */
export async function setOrderStatus(orderId: string, status: OrderStatus) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { data: before } = await sb.from("orders").select("status,ref").eq("id", orderId).single();
  if (before) {
    if (before.status === "cancelled") {
      // Cancelled is now a fully terminal state -- no reassigning a
      // cancelled order back into the flow, and no cancelling it again.
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
  }
  const { error } = await sb.from("orders").update({ status }).eq("id", orderId);
  if (error) throw error;
  if (before) {
    await sb.from("order_log").insert({ order_id: orderId, text: `Estadu: ${before.status} → ${status}` });
  }
  revalidatePath("/admin/orders");
}

/** G4 — manual payment status, set by the owner (no gateway). */
export async function setPayStatus(orderId: string, payStatus: PayStatus) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("orders").update({ pay_status: payStatus }).eq("id", orderId);
  if (error) throw error;
  await sb.from("order_log").insert({ order_id: orderId, text: `Pagamentu: ${payStatus}` });
  revalidatePath("/admin/orders");
}

/** F6 — free-text internal note. Stored with a leading "* " marker so it
 * can be told apart from the automatic status/payment/system log lines
 * (e.g. "Estadu: new → confirmed") and surfaced on the buyer's tracking
 * page as an extra "* - ..." line on the status timeline. */
export async function addOrderNote(orderId: string, text: string) {
  await requireAdmin();
  if (!text.trim()) return;
  const sb = supabaseAdmin();
  await sb.from("order_log").insert({ order_id: orderId, text: `* ${text.trim()}` });
  revalidatePath("/admin/orders");
}

/** F6b — edit a previously added free-text note. Restricted to entries
 * that were themselves free-text notes (the leading "* " marker) so an
 * admin can never rewrite an automatic status/payment/system log line
 * into something misleading. */
export async function editOrderNote(orderId: string, logId: number, text: string) {
  await requireAdmin();
  if (!text.trim()) return;
  const sb = supabaseAdmin();
  const { data: row } = await sb.from("order_log").select("text").eq("id", logId).eq("order_id", orderId).single();
  if (!row || !row.text.trim().startsWith("* ")) throw new Error("This entry can't be edited");
  await sb.from("order_log").update({ text: `* ${text.trim()}` }).eq("id", logId).eq("order_id", orderId);
  revalidatePath("/admin/orders");
}
