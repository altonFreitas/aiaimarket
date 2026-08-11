"use server";
import { requireAdmin } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { phoneNorm, phoneOk } from "@/lib/utils";
import { revalidatePath } from "next/cache";
import type { OrderItem, OrderStatus, PayMethod, PayStatus } from "@/lib/types";

/** Sequential fallback, used only for pickup orders (no delivery zone to
 * derive a code from). Unchanged from before this feature. */
async function nextPickupRef(): Promise<string> {
  const sb = supabaseAdmin();
  const year = new Date().getFullYear();
  const { count } = await sb.from("orders").select("*", { count: "exact", head: true });
  return `ORD-${year}-${String((count || 0) + 1).padStart(4, "0")}`;
}

/** Delivery orders get a zone-coded reference the customer can recognise
 * at a glance, and that already carries the info a courier needs:
 *   Central Dili         → CD + year + last4(phone) + 6 random digits
 *   Dili outskirts        → DO + year + last4(phone) + 6 random digits
 *   Other municipality    → OM + first 2 letters of municipality
 *                            + year + last4(phone) + 6 random digits
 * Collision odds are astronomically small (1 in a million per attempt
 * before even considering phone/year), but we still check and retry —
 * `ref` is UNIQUE in the database, so an unlucky collision must never
 * surface as a raw insert error to the buyer. */
async function nextDeliveryRef(zoneId: string, normalizedPhone: string, municipality?: string): Promise<string> {
  const sb = supabaseAdmin();
  const year = new Date().getFullYear();
  const phoneDigits = normalizedPhone.replace(/[^\d]/g, "");
  const last4 = phoneDigits.slice(-4).padStart(4, "0");

  let prefix: string;
  if (zoneId === "dili_center") prefix = "CD";
  else if (zoneId === "dili_outskirts") prefix = "DO";
  else {
    const letters = (municipality || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
      .replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2).padEnd(2, "X");
    prefix = "OM" + letters;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const rand = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    const ref = `${prefix}${year}${last4}${rand}`;
    const { data } = await sb.from("orders").select("id").eq("ref", ref).maybeSingle();
    if (!data) return ref;
  }
  throw new Error("Could not generate a unique order reference — please try again");
}

export interface PlaceOrderInput {
  name: string;
  phone: string;
  items: OrderItem[];
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
  const zones = (settings?.zones as any[]) || [];
  const zone = input.mode === "delivery" ? zones.find((z) => z.id === input.zoneId) : null;
  const fee = zone && !zone.quote ? Number(zone.fee) : 0;
  const subtotal = input.items.reduce((a, i) => a + i.price * i.qty, 0);
  const normalizedPhone = phoneNorm(input.phone);
  const ref = input.mode === "delivery"
    ? await nextDeliveryRef(input.zoneId || "", normalizedPhone, input.municipality)
    : await nextPickupRef();

  const { data, error } = await sb
    .from("orders")
    .insert({
      ref,
      buyer_name: input.name.trim(),
      buyer_phone: normalizedPhone,
      items: input.items,
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
  data.order_log?.sort((a: any, b: any) => a.id - b.id);
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

/** F4 — status machine, including the F5 stock-decrement trigger in Postgres. */
export async function setOrderStatus(orderId: string, status: OrderStatus) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { data: before } = await sb.from("orders").select("status,ref").eq("id", orderId).single();
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
