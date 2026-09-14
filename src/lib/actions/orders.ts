"use server";
import { requireAdmin } from "./guard";
import { audit, change } from "@/lib/audit";
import { issueTrackToken } from "@/lib/trackToken";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PROOF_URL_SECONDS, PROOF_URL_FALLBACK_SECONDS, withFreshProofUrl } from "@/lib/paymentProof";
import { writeTolerating } from "@/lib/missingColumn";
import { orderRef, phoneNorm, phoneOk } from "@/lib/utils";
import { assertOrderTransition } from "@/lib/orderFlow";
import { rateLimit, callerKey } from "@/lib/rateLimit";
import { normalizeName } from "@/lib/personName";
import { decodeImageDataUrl } from "@/lib/uploadGuard";
import { reportError } from "@/lib/observability";
import { voidOrderAuthorization } from "@/lib/payments/service";
import { revalidatePath } from "next/cache";
import { getLang } from "@/lib/lang";
import { notifyOrderEventInBackground } from "@/lib/notify/service";
import { notifyStatusChange } from "@/lib/orderNotify";
import type { Order, OrderItem, OrderLogEntry, OrderStatus, PayMethod, PayStatus, Zone } from "@/lib/types";

/** Trims and hard-truncates a free-text field. Postgres `text` has no
 * length limit, so without this a single request can write megabytes. */
function clip(v: string | undefined | null, max: number): string {
  return (v || "").trim().slice(0, max);
}

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

  for (let attempt = 0; attempt < 5; attempt++) {
    // Format lives in orderRef() so it can be tested without a database;
    // the collision check and retry stay here, where the database is.
    const ref = orderRef(prefix, normalizedPhone, year, Math.random() * 1_000_000);
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
  /** One per checkout attempt, minted in the browser. A retry of the same
   * attempt returns the order the first one made, rather than making a
   * second. Optional: an older client that does not send one gets exactly
   * the behaviour it had before. */
  idempotencyKey?: string;
}

/** F1/F2 — guest checkout, no account. Uses the ANON client (not admin):
 * RLS explicitly allows public INSERT on orders and nothing else, so this
 * is safe to call from a client action without extra guarding. */
/** Hard ceilings on anything a guest can send. An unauthenticated action
 * that writes to the database needs an upper bound on every dimension of
 * its input, or it becomes a free write-amplification primitive. */
const MAX_LINE_QTY = 999;
const MAX_BASKET_LINES = 50;
const MAX_NAME_LEN = 120;
const MAX_NOTE_LEN = 2000;
/** A UUID is 36; the cap is only there so a caller cannot make the index
 * entry arbitrarily large. */
const MAX_IDEM_LEN = 64;
const MAX_ADDRESS_FIELD_LEN = 200;

/** The order a previous attempt with this key already made, or null.
 *
 * Tolerant of the column not existing: on a database that has not run
 * supabase/order-idempotency.sql the query errors and this reports "no
 * previous attempt", which is exactly the behaviour the shop had before
 * the column was introduced. */
/** What placeOrder hands back: the reference, and a token that unlocks that
 * one order without the phone number appearing in the URL.
 *
 * A type rather than a bare string because there are THREE ways out of
 * placeOrder -- the ordinary one, the fast idempotency replay, and the
 * conflict handler when two copies of the same attempt race -- and a retry
 * on a flaky connection has to land the buyer on their order exactly as the
 * first attempt would have. Returning a plain ref from the replay paths
 * would have sent a retrying buyer to the phone gate. */
export interface PlacedOrder {
  ref: string;
  token: string;
}

/** The pair, built in one place so the three exits cannot drift apart. */
function placed(ref: string, phone: string): PlacedOrder {
  return { ref, token: issueTrackToken(ref, phoneNorm(phone)) };
}

async function findByIdempotencyKey(key: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("orders").select("ref").eq("idempotency_key", key).maybeSingle();
    if (error) return null;
    return (data?.ref as string) ?? null;
  } catch { return null; }
}

/** Holds this order's units, or explains why it cannot.
 *
 * Tolerant of the function not existing: on a database that has not run
 * supabase/stock-reservation.sql there is nothing to call, and the shop
 * behaves exactly as it did before -- stock moving on confirmation. A
 * missing migration must never stop a shop selling.
 *
 * Every OTHER failure is refused, and refused loudly. The whole point of
 * this call is that it is the one thing standing between two buyers and
 * the same last unit; treating an unrecognised error as "probably fine"
 * would hand back the bug it was written to close. */
async function reserveStock(
  sb: ReturnType<typeof supabaseAdmin>, orderId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await sb.rpc("reserve_order_stock", { p_order_id: orderId });
  if (!error) return { ok: true };

  // 42883 undefined_function, PGRST202 no such RPC in PostgREST's schema
  // cache. Both mean the migration has not been run.
  const code = (error as { code?: string }).code || "";
  if (code === "42883" || code === "PGRST202") return { ok: true };

  // 23514 check_violation is the function saying the basket does not fit,
  // and its message already names the product and the quantity left --
  // written for a shopper to read, in reserve_order_stock().
  const message = (error as { message?: string }).message || "";
  if (code === "23514" && message) return { ok: false, message };
  if (code === "P0002" || code === "02000") {
    return { ok: false, message: "A product in your basket is no longer available" };
  }

  reportError(error, { scope: "reserve_order_stock", orderId });
  return { ok: false, message: "We could not hold the stock for this order. Please try again." };
}

export async function placeOrder(input: PlaceOrderInput) {
  if (!input.name.trim()) throw new Error("Name is required");
  if (!phoneOk(input.phone)) throw new Error("Invalid phone number");
  if (!input.items.length) throw new Error("Basket is empty");
  if (input.items.length > MAX_BASKET_LINES) throw new Error("Too many items in one order");

  // Unauthenticated, writes to the database, sends no payment — exactly the
  // shape of endpoint that gets scripted. 10 orders / 10 minutes per IP.
  const orderLimit = await rateLimit(await callerKey("place-order"), 10, 600);
  if (!orderLimit.allowed) {
    throw new Error(`Too many orders from this connection. Try again in ${orderLimit.retryAfterSeconds}s.`);
  }

  // A RETRY IS NOT A SECOND ORDER. Checked before any work is done, so a
  // resubmission on a flaky connection costs one indexed lookup rather
  // than a second set of stock movements and a second SMS. The unique
  // index is what actually guarantees it (supabase/order-idempotency.sql);
  // this is the fast path, and the conflict handler after the insert is
  // the one that catches two requests racing each other.
  const idemKey = clip(input.idempotencyKey, MAX_IDEM_LEN) || null;
  if (idemKey) {
    const found = await findByIdempotencyKey(idemKey);
    if (found) return placed(found, input.phone);
  }

  // Fee + zone resolution happens server-side against real settings,
  // never trusted from the client.
  const sb = supabaseAdmin(); // service role: needed to read settings.zones reliably & to insert with computed ref
  const { data: settings } = await sb.from("settings").select("zones, commission_rate").eq("id", 1).single();
  const zones = (settings?.zones as Zone[]) || [];
  const zone = input.mode === "delivery" ? zones.find((z) => z.id === input.zoneId) : null;
  let fee = zone && !zone.quote ? Number(zone.fee) : 0;
  const normalizedPhone = phoneNorm(input.phone);

  // Resolve each item's seller_id server-side, never from the client --
  // this is what makes it possible to later show a seller only their own
  // items in a mixed-cart order, and to compute their earnings. A
  // product with no real seller (still just the platform owner's own
  // catalog) resolves to whatever seller_id the products row already
  // has by default, same as everywhere else in the schema.
  // priceIsAuthoritative — the basket lives in the buyer's localStorage, so
  // NOTHING it claims about price, name or seller may be trusted. Every line
  // is re-read from `products` and re-priced here; the client's numbers are
  // used only to say WHICH product and HOW MANY. Without this, a crafted
  // request buys a $500 item for $0.01.
  const productIds = [...new Set(input.items.map((i) => i.product_id))];
  const { data: prodRows } = await sb
    .from("products")
    .select("id, seller_id, name, price, discount_price, qty, stock_status, archived, status, preorder_enabled")
    .in("id", productIds);
  const byId = new Map((prodRows || []).map((row) => [row.id as string, row]));

  // Unit cost at the moment of sale, so gross margin reporting is anchored
  // to what these goods actually cost then rather than what they cost when
  // someone opens the dashboard. Read with the same service-role client the
  // rest of this action uses -- product_costs has no anon grant at all.
  // Wrapped because a store that has not run supabase/sales.sql yet has no
  // such table, and a missing cost must never block a sale.
  const costByProduct = new Map<string, number>();
  try {
    const { data: costRows } = await sb
      .from("product_costs").select("product_id, cost_price").in("product_id", productIds);
    for (const row of costRows || []) {
      costByProduct.set(row.product_id as string, Number(row.cost_price));
    }
  } catch { /* costs are optional; the dashboard reports coverage */ }

  /* THE COMMISSION RATE, AS IT STANDS RIGHT NOW.
   *
   * Snapshotted onto every line for the same reason the cost above is: a
   * rate is a term of the deal on the day of the sale, not a property of
   * the seller for all time. Without this, agreeing a lower rate with a
   * store rewrote what the platform owed them on every order they had ever
   * completed.
   *
   * A seller's own rate beats the platform default, which is the same
   * precedence computeSellerEarnings() has always applied -- the change is
   * WHEN it is applied, not what it resolves to. Lines with no seller (the
   * marketplace's own goods) carry no rate: there is no commission on
   * selling to yourself. */
  const rateBySeller = new Map<string, number>();
  const platformRate = Number(settings?.commission_rate ?? 0);
  try {
    const sellerIds = [...new Set(
      (prodRows || []).map((r) => (r.seller_id as string | null) ?? "").filter(Boolean))];
    if (sellerIds.length) {
      const { data: sellerRows } = await sb
        .from("sellers").select("id, commission_rate").in("id", sellerIds);
      for (const r of sellerRows || []) {
        rateBySeller.set(r.id as string, Number(r.commission_rate ?? platformRate));
      }
    }
  } catch { /* fall back to the platform rate for every line */ }

  // Set inside the map below when any line turns out to be out of stock.
  let isPreorder = false;

  const itemsWithSeller: OrderItem[] = input.items.map((i) => {
    const row = byId.get(i.product_id);
    if (!row) throw new Error("A product in your basket is no longer available");
    if (row.archived || row.status !== "approved") {
      throw new Error(`"${row.name}" is no longer available`);
    }
    // Out of stock is no longer the end of the conversation: if the shop
    // allows pre-orders on this product, the line is accepted and the whole
    // order becomes a pre-order. The decision is made HERE, from the live
    // row -- never from anything the browser sent. A client able to declare
    // its own order a pre-order would be declaring the right to buy what is
    // not there.
    //
    // preorder_enabled is read as enabled when the column is absent, which
    // matches the column default for a database that has run
    // supabase/preorders.sql and is the friendlier default for one that
    // has not.
    // Per LINE, not per order. The order-wide flag below is what the ref
    // and the is_preorder column are built from, but the quantity ceiling
    // has to ask about this product -- one pre-ordered line in a basket
    // must not lift the limit off everything else in it.
    const linePreorder = row.stock_status === "out";
    if (linePreorder) {
      const allowed = (row as { preorder_enabled?: boolean }).preorder_enabled !== false;
      if (!allowed) throw new Error(`"${row.name}" is out of stock`);
      isPreorder = true;
    }

    const qty = Math.floor(Number(i.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_LINE_QTY) {
      throw new Error(`Invalid quantity for "${row.name}"`);
    }
    // NO `row.qty > 0 &&` GUARD ON THIS. It used to read
    // `if (row.qty > 0 && qty > row.qty)`, which meant that a product sitting
    // at qty = 0 whose stock_status had not yet been flipped to 'out'
    // short-circuited the whole check -- so ANY quantity was accepted, with
    // no limit at all, on exactly the products most likely to be racing
    // towards zero. Out-of-stock is handled above (as a pre-order or a
    // refusal); this is the quantity ceiling and it applies always.
    if (!linePreorder && qty > row.qty) {
      throw new Error(`Only ${row.qty} left of "${row.name}"`);
    }

    // The discount is the store's, not the buyer's, to declare.
    const unitPrice = row.discount_price != null && Number(row.discount_price) > 0
      ? Number(row.discount_price)
      : Number(row.price);

    // Size is the one value the buyer genuinely chooses, so it is kept from
    // the request — bounded, not validated against row.sizes, because sizes
    // are free-text in this schema and legacy baskets may hold older values.
    const size = typeof i.size === "string" ? i.size.slice(0, 40) : "";

    return {
      product_id: row.id,
      seller_id: (row.seller_id as string | null) ?? null,
      name: row.name as string,
      size,
      price: unitPrice,
      qty,
      // Omitted entirely when unknown, so "no cost recorded" stays
      // distinguishable from "costs nothing" for the whole life of the row.
      ...(costByProduct.has(row.id as string)
        ? { cost: costByProduct.get(row.id as string) }
        : {}),
      // Same rule, same reason: present only when there is a seller to
      // take a commission from, so "the shop's own goods" and "a rate
      // nobody recorded" stay distinguishable forever.
      ...(rateBySeller.has((row.seller_id as string) || "")
        ? { commission_rate: rateBySeller.get(row.seller_id as string) }
        : {}),
    };
  });

  const subtotal = itemsWithSeller.reduce((a, i) => a + i.price * i.qty, 0);

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

  // A pre-order takes PRO rather than a zone code, so the reference itself
  // says what kind of order it is -- on the buyer's SMS, in the admin list
  // and on the tracking page, with nothing extra to look up.
  const ref = isPreorder
    ? await nextRefWithPrefix("PRO", normalizedPhone)
    : input.mode === "delivery"
      ? await nextRefWithPrefix(deliveryPrefix(input.zoneId || "", input.municipality), normalizedPhone)
      : await nextRefWithPrefix("PP", normalizedPhone);

  // The language the buyer was actually browsing in, captured now because
  // this is the only moment it is knowable -- the notifications that follow
  // are sent from an admin's session, in the admin's language, potentially
  // days later.
  const lang = await getLang();

  const { data, error } = await writeTolerating<Order>(
    { idempotency_key: idemKey },
    (extra) => sb
    .from("orders")
    .insert({
      ...extra,
      ref,
      lang,
      is_preorder: isPreorder,
      // Normalised here as well as in the form. The form is the only
      // place a person types this, but it is not the only place the
      // request can come from -- and the sales screens' promise that one
      // phone number is one customer with one name has to hold against
      // whatever actually arrives.
      buyer_name: clip(normalizeName(input.name), MAX_NAME_LEN),
      buyer_phone: normalizedPhone,
      items: itemsWithSeller,
      mode: input.mode,
      zone_id: input.mode === "delivery" ? input.zoneId : null,
      fee,
      quote_requested: !!(zone && zone.quote),
      subtotal,
      total: subtotal + fee,
      address_line: input.mode === "delivery" ? clip(input.addressLine, MAX_ADDRESS_FIELD_LEN) || null : null,
      municipality: input.mode === "delivery" ? clip(input.municipality, MAX_ADDRESS_FIELD_LEN) || null : null,
      post: input.mode === "delivery" ? clip(input.post, MAX_ADDRESS_FIELD_LEN) || null : null,
      suku: input.mode === "delivery" ? clip(input.suku, MAX_ADDRESS_FIELD_LEN) || null : null,
      aldeia: input.mode === "delivery" ? clip(input.aldeia, MAX_ADDRESS_FIELD_LEN) || null : null,
      landmark: input.mode === "delivery" ? clip(input.landmark, MAX_ADDRESS_FIELD_LEN) : null,
      pay_method: input.payMethod,
      pay_status: "unpaid",
      note: clip(input.note, MAX_NOTE_LEN),
      status: "new",
    })
    .select()
    .single()
  );
  // 23505 on the idempotency index means the SAME attempt arrived twice and
  // the other one won the race. That is a success, not a failure: read back
  // what it made and hand the buyer the same reference. Anything else is a
  // real error.
  if (error) {
    const code = (error as { code?: string }).code;
    if (idemKey && code === "23505") {
      const existing = await findByIdempotencyKey(idemKey);
      if (existing) return placed(existing, input.phone);
    }
    throw error;
  }
  if (!data) throw new Error("The order was not created.");

  /* THE UNITS ARE HELD HERE, NOT WHEN AN ADMIN GETS ROUND TO IT.
   *
   * Everything above re-read prices and quantities from the database and
   * refused a line that did not fit -- but a read followed by an insert is
   * a race, and the thing being raced for is the last unit of whatever is
   * selling. This is the half that cannot be written in TypeScript: the
   * function locks each product row (SELECT ... FOR UPDATE), re-checks the
   * whole basket against the locked rows, and writes the holds, with
   * nothing able to slip between the check and the write.
   *
   * ORDER FIRST, THEN RESERVE. The ledger's movements reference an order,
   * so the row has to exist before its stock can be held against it. The
   * window between the two is real and is closed by unwinding: if the
   * reservation fails, the order that was just created is deleted and the
   * buyer is told what actually happened. Nothing has seen that order --
   * no notification has been sent, no admin screen has been revalidated --
   * so removing it leaves no trace to explain later. */
  const reserved = await reserveStock(sb, data.id as string);
  if (!reserved.ok) {
    await sb.from("orders").delete().eq("id", data.id);
    throw new Error(reserved.message);
  }

  await sb.from("order_log").insert({
    order_id: data.id,
    text: `Enkomenda simu (${input.mode === "delivery" ? "entrega" : "foti rasik"})`,
  });

  // The buyer gets their tracking link straight away, so it is sitting in
  // their messages before they have closed the tab -- and every later update
  // lands in the same thread rather than arriving as an orphan.
  const { data: storeRow } = await sb.from("settings").select("store_name").eq("id", 1).maybeSingle();
  notifyOrderEventInBackground(data, "placed", storeRow?.store_name || "Loja");

  revalidatePath("/admin/orders");
  /* THE REFERENCE AND A TOKEN THAT UNLOCKS IT.
   *
   * The token is the same one the store's own SMS carries -- an HMAC over
   * the reference and the phone, keyed with SESSION_SECRET (lib/trackToken).
   * It does NOT contain the phone number, which is the whole reason it
   * exists: an earlier /o/<ref>?phone=... link leaked the number into
   * browser history, WhatsApp previews and every Referer header the page
   * emitted.
   *
   * It is returned rather than stashed in sessionStorage because the buyer
   * is about to be sent to a page that must render their order on the FIRST
   * paint and must still do so if they reload it. A handoff that is read
   * once and erased could do neither. */
  return placed(data.ref as string, input.phone);
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
    // .eq(), never .ilike(): in Postgres LIKE patterns "%" and "_" are
    // wildcards, so an .ilike() on raw user input lets ref="%" match an
    // arbitrary order instead of one exact reference.
    .eq("ref", ref.trim().toUpperCase())
    .maybeSingle();
  if (!data) return null;
  if (data.buyer_phone !== phoneNorm(phone)) return null;
  data.order_log?.sort((a: OrderLogEntry, b: OrderLogEntry) => a.id - b.id);
  // The stored proof_url is not handed out; a fresh, short-lived one is
  // minted for this viewing. See lib/paymentProof.ts.
  return await withFreshProofUrl(data);
}

/** "My Orders" — knowing the phone number alone reveals every order made
 * with it, no code or password. This is intentionally the same trust
 * level as guest checkout already uses (the spec's Decision 3: phone
 * number is the identity), just widened from one order to all of them —
 * no new accounts table, no SMS provider, no added cost. */
export async function getOrdersByPhone(phone: string) {
  if (!phoneOk(phone)) return [];
  // A phone number is the ONLY credential here (Decision 3), so this
  // endpoint is a standing offer to enumerate the store's customers.
  // Throttling doesn't fix the trust model, but it makes bulk harvesting
  // expensive. 20 lookups / 5 minutes per IP.
  const lookupLimit = await rateLimit(await callerKey("order-lookup"), 20, 300);
  if (!lookupLimit.allowed) return [];
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
  if (["completed", "cancelled"].includes(order.status)) {
    throw new Error("This order is closed");
  }
  const sb = supabaseAdmin();
  // This is reachable by anyone holding a ref + phone, so the size cap and
  // format check are the only thing between the form and arbitrary blobs
  // in the storage bucket.
  const { bytes, contentType, ext } = decodeImageDataUrl(dataUrl, 512);
  const path = `proofs/${order.ref}-${Date.now()}.${ext}`;
  const { error } = await sb.storage.from("payment-proofs").upload(path, bytes, {
    contentType,
  });
  if (error) throw error;

  /* THE PATH IS THE RECORD, not the URL. A signed URL grants access to
   * whoever holds it, with no session behind it, so storing one on the
   * order row means a customer's bank slip is readable by anyone who ever
   * sees that row. Readers mint their own, briefly -- see lib/paymentProof.
   *
   * A short URL is still written alongside it so the page that comes back
   * from this upload can show what was just uploaded. */
  const { data: signed } = await sb.storage
    .from("payment-proofs").createSignedUrl(path, PROOF_URL_SECONDS);
  const written = await writeTolerating({ proof_path: path }, (extra) =>
    sb.from("orders").update({ proof_url: signed?.signedUrl, ...extra }).eq("id", order.id));

  // No proof_path column yet: the URL is the only record of this file, so
  // it has to outlive the request that wrote it. Thirty days, not a year.
  if (written.degraded) {
    const { data: longer } = await sb.storage
      .from("payment-proofs").createSignedUrl(path, PROOF_URL_FALLBACK_SECONDS);
    if (longer?.signedUrl) {
      await sb.from("orders").update({ proof_url: longer.signedUrl }).eq("id", order.id);
    }
  }
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
  // Rules live in lib/orderFlow.ts so the admin path and the seller path
  // (lib/actions/seller-orders.ts) share one implementation instead of two
  // copies that drift.
  if (before) assertOrderTransition(before.status as OrderStatus, status);
  const { error } = await sb.from("orders").update({ status }).eq("id", orderId);
  if (error) throw error;
  if (before) {
    await sb.from("order_log").insert({ order_id: orderId, text: `Estadu: ${before.status} → ${status}` });
  }

  /* CANCELLING DOES NOTHING AT THE BANK.
   *
   * There is no void and no refund on the provider interface (see
   * lib/payments/types.ts), so a card order that was authorised or
   * captured and is now cancelled leaves the buyer's money with BNCTL
   * and nothing in this application asking for it back. Said on the
   * order itself, where whoever cancelled it is looking, as well as on
   * the home page's list (attention.ts, "cards_to_void") -- one of them
   * is read at the moment it happens and the other keeps asking until
   * it is done. */
  if (status === "cancelled" && before) {
    const { data: pay } = await sb
      .from("orders").select("pay_method, pay_status").eq("id", orderId).maybeSingle();
    if (pay?.pay_method === "card" && (pay.pay_status === "paid" || pay.pay_status === "deposit")) {
      /* AN AUTHORIZATION IS RELEASED, NOT LEFT TO EXPIRE.
       *
       * A hold the shop will never capture sits on the buyer's card until
       * the acquirer expires it on its own schedule -- typically seven
       * days, during which the money is neither theirs nor the shop's.
       * The state machine has always modelled authorized -> cancelled;
       * until the provider grew a voidAuthorization() nothing could drive
       * it.
       *
       * Tried, not assumed. Only an authorization can be voided; a
       * captured payment needs a refund, which is a different act with a
       * different record, and the service says which this is. Either way
       * the order is already cancelled -- the money is a separate
       * question and a failure here must not undo that. */
      const voided = await voidOrderAuthorization(orderId);
      await sb.from("order_log").insert({
        order_id: orderId,
        text: voided.ok
          ? "* Osan kliente nian libre ona iha banku (void)."
          : "* Osan kliente nian sei iha BNCTL. Halo void ka reembolsu iha portál, "
            + "depois troka pagamentu ba 'refunded'."
            + (voided.reason ? ` (${voided.reason})` : ""),
      });
    }
  }

  await notifyStatusChange(orderId, status);
  revalidatePath("/admin/orders");
}


/** G4 — manual payment status, set by the owner (no gateway). */
export async function setPayStatus(orderId: string, payStatus: PayStatus) {
  const actor = await requireAdmin();
  const sb = supabaseAdmin();
  // Read first, so the record can say what it changed FROM. order_log has
  // always noted the new value; it has never said who, or what it was
  // before.
  const { data: before } = await sb
    .from("orders").select("ref, pay_status").eq("id", orderId).maybeSingle();
  const { error } = await sb.from("orders").update({ pay_status: payStatus }).eq("id", orderId);
  if (error) throw error;
  await sb.from("order_log").insert({ order_id: orderId, text: `Pagamentu: ${payStatus}` });

  await audit(actor, {
    action: "order.payStatus", entity: "order", entityId: orderId,
    summary: `${before?.ref || orderId}: payment ${change(before?.pay_status ?? "?", payStatus)}`,
    meta: { from: before?.pay_status ?? null, to: payStatus },
  });
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
