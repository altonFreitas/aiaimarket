"use server";
import { requireAdmin } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { PoCategory, PoPaymentStatus, PoStatus } from "@/lib/types";
import { todayIso } from "@/lib/procurement";

const MAX_NAME = 160;
const MAX_TEXT = 2000;
const MAX_LINES = 200;

const CATEGORIES: readonly PoCategory[] = [
  "goods_for_resale",
  "raw_materials", "components", "packaging", "office", "equipment", "services", "other",
];
const STATUSES: readonly PoStatus[] = [
  "draft", "approved", "sent", "confirmed", "in_production",
  "in_transit", "arrived", "received", "cancelled",
];
const PAYMENT_STATUSES: readonly PoPaymentStatus[] = ["unpaid", "partial", "paid", "overdue"];

function clip(v: string | undefined | null, max: number): string {
  return (v || "").trim().slice(0, max);
}

/** Rejects anything that is not a real YYYY-MM-DD calendar day. `new Date()`
 * alone is not enough: it happily accepts "2026-02-31" and silently rolls it
 * forward to March, which would then be compared against real dates. */
function cleanDate(v: string | undefined | null): string | null {
  const s = (v || "").trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Invalid date: ${s}`);
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new Error(`Invalid date: ${s}`);
  }
  return s;
}

function money(v: unknown, field: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be zero or more`);
  return Math.round(n * 100) / 100;
}

/* ---------------------------- suppliers ---------------------------- */

export interface SupplierInput {
  id?: string;
  name: string;
  countryCode: string;
  contactName?: string;
  email?: string;
  phone?: string;
  leadTimeDays?: number | null;
  notes?: string;
  active?: boolean;
}

export async function saveSupplier(input: SupplierInput): Promise<string> {
  await requireAdmin();
  const name = clip(input.name, MAX_NAME);
  if (!name) throw new Error("Supplier name is required");

  // Uppercased and length-checked here as well as in the database: the
  // dashboard groups by this value, and "pt" beside "PT" is two countries.
  const countryCode = clip(input.countryCode, 2).toUpperCase();
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
    throw new Error("Country must be a two-letter code");
  }

  const lead = input.leadTimeDays;
  if (lead != null && (!Number.isFinite(Number(lead)) || Number(lead) < 0)) {
    throw new Error("Lead time must be zero or more days");
  }

  const row = {
    name,
    country_code: countryCode,
    contact_name: clip(input.contactName, MAX_NAME),
    email: clip(input.email, MAX_NAME),
    phone: clip(input.phone, 40),
    lead_time_days: lead == null || lead === ("" as unknown) ? null : Math.round(Number(lead)),
    notes: clip(input.notes, MAX_TEXT),
    active: input.active !== false,
  };

  const sb = supabaseAdmin();
  if (input.id) {
    const { error } = await sb.from("suppliers").update(row).eq("id", input.id);
    if (error) throw error;
    revalidatePath("/admin/procurement", "layout");
    return input.id;
  }
  const { data, error } = await sb.from("suppliers").insert(row).select("id").single();
  if (error) throw error;
  revalidatePath("/admin/procurement", "layout");
  return data.id as string;
}

/** Deactivates rather than deletes when the supplier has history.
 *
 * A supplier row is what explains where money went; removing one would
 * orphan that history, and the foreign key is ON DELETE RESTRICT precisely
 * so the database refuses. Deactivating keeps the record and takes them out
 * of the pickers, which is what "we don't buy from them any more" means. */
export async function deleteSupplier(id: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { count } = await sb
    .from("purchase_orders")
    .select("id", { count: "exact", head: true })
    .eq("supplier_id", id);

  if (count && count > 0) {
    const { error } = await sb.from("suppliers").update({ active: false }).eq("id", id);
    if (error) throw error;
    revalidatePath("/admin/procurement", "layout");
    return { deactivated: true, orders: count };
  }

  const { error } = await sb.from("suppliers").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/procurement", "layout");
  return { deactivated: false, orders: 0 };
}

/* ------------------------- purchase orders ------------------------- */

export interface PoLineInput {
  productId?: string | null;
  productName: string;
  category: PoCategory;
  qty: number;
  unitPrice: number;
  /** Shop category for a product this line will create on receipt. */
  catalogCategoryId?: string | null;
  /** Its shelf price. Unrelated to the purchase price, so it is stated. */
  sellPrice?: number | null;
  /** Sizes as typed, e.g. "S, M, L, XL". */
  sizes?: string;
  description?: string;
}

export interface PurchaseOrderInput {
  id?: string;
  poNumber?: string;
  supplierId: string;
  buyer?: string;
  orderDate: string;
  expectedArrival?: string | null;
  actualArrival?: string | null;
  currency?: string;
  fxRate?: number;
  tax?: number;
  shipping?: number;
  discount?: number;
  status: PoStatus;
  paymentStatus: PoPaymentStatus;
  paymentDate?: string | null;
  notes?: string;
  lines: PoLineInput[];
}

/** PO-YYYY-NNNN, sequential within the year. Reads the highest existing
 * number for the year rather than counting rows, so deleting a draft does
 * not cause the next order to reuse a number that has already been sent to
 * a supplier. */
async function nextPoNumber(year: number): Promise<string> {
  const sb = supabaseAdmin();
  const prefix = `PO-${year}-`;
  const { data } = await sb
    .from("purchase_orders")
    .select("po_number")
    .like("po_number", `${prefix}%`)
    .order("po_number", { ascending: false })
    .limit(1);
  const last = data?.[0]?.po_number as string | undefined;
  const n = last ? Number(last.slice(prefix.length)) : 0;
  return prefix + String((Number.isFinite(n) ? n : 0) + 1).padStart(4, "0");
}

export async function savePurchaseOrder(input: PurchaseOrderInput): Promise<string> {
  await requireAdmin();

  if (!input.supplierId) throw new Error("Supplier is required");
  if (!STATUSES.includes(input.status)) throw new Error("Unknown purchase order status");
  if (!PAYMENT_STATUSES.includes(input.paymentStatus)) throw new Error("Unknown payment status");

  const orderDate = cleanDate(input.orderDate);
  if (!orderDate) throw new Error("Order date is required");
  const expected = cleanDate(input.expectedArrival);
  const actual = cleanDate(input.actualArrival);
  if (actual && actual < orderDate) {
    throw new Error("Arrival date cannot be before the order date");
  }

  const lines = (input.lines || []).filter((l) => (l.productName || "").trim());
  if (!lines.length) throw new Error("Add at least one line item");
  if (lines.length > MAX_LINES) throw new Error("Too many line items on one order");

  const currency = clip(input.currency, 3).toUpperCase() || "USD";
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a three-letter code");

  const fxRate = Number(input.fxRate ?? 1);
  if (!Number.isFinite(fxRate) || fxRate <= 0) throw new Error("Exchange rate must be greater than zero");
  // A rate is only meaningful against a different currency; silently storing
  // 1.15 on a USD order would misstate every total it appears in.
  if (currency === "USD" && fxRate !== 1) {
    throw new Error("The exchange rate for USD must be 1");
  }

  const sb = supabaseAdmin();
  const { data: supplier } = await sb.from("suppliers").select("id").eq("id", input.supplierId).maybeSingle();
  if (!supplier) throw new Error("Supplier not found");

  const header = {
    supplier_id: input.supplierId,
    buyer: clip(input.buyer, MAX_NAME),
    order_date: orderDate,
    expected_arrival: expected,
    actual_arrival: actual,
    currency,
    fx_rate: fxRate,
    tax: money(input.tax ?? 0, "Tax"),
    shipping: money(input.shipping ?? 0, "Shipping"),
    discount: money(input.discount ?? 0, "Discount"),
    status: input.status,
    payment_status: input.paymentStatus,
    payment_date: cleanDate(input.paymentDate),
    notes: clip(input.notes, MAX_TEXT),
  };

  const rows = lines.map((l) => {
    const qty = Number(l.qty);
    const unitPrice = Number(l.unitPrice);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Quantity must be greater than zero for "${l.productName}"`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error(`Unit price cannot be negative for "${l.productName}"`);
    const sellPrice = l.sellPrice == null || Number.isNaN(Number(l.sellPrice))
      ? null : Number(l.sellPrice);
    if (sellPrice != null && sellPrice < 0) {
      throw new Error(`Selling price cannot be negative for "${l.productName}"`);
    }
    return {
      product_id: l.productId || null,
      product_name: clip(l.productName, MAX_NAME),
      category: CATEGORIES.includes(l.category) ? l.category : ("other" as PoCategory),
      qty,
      unit_price: unitPrice,
      catalog_category_id: l.catalogCategoryId || null,
      sell_price: sellPrice,
      sizes: clip(l.sizes, MAX_NAME),
      description: clip(l.description, MAX_TEXT),
    };
  });

  let poId = input.id;
  if (poId) {
    // Lines are replaced wholesale below, which would orphan the receipt
    // ledger: stock_movements points at a line id, and deleting the line
    // nulls that link. The idempotency guard would then be gone, and the
    // next move to "received" would add the stock a SECOND time.
    //
    // So an order whose goods have already landed is closed to line edits.
    // That is also the right business rule on its own -- once the goods are
    // on the shelf, the order is the record of what arrived, not a draft.
    const { data: receipts } = await sb
      .from("stock_movements").select("id")
      .eq("po_id", poId).eq("reason", "purchase_receipt").limit(1);
    if (receipts && receipts.length) {
      throw new Error(
        "This order has already been received, so its lines can no longer be " +
        "changed. Record a stock adjustment instead."
      );
    }

    const { error } = await sb.from("purchase_orders").update(header).eq("id", poId);
    if (error) throw error;
    // Lines are replaced wholesale rather than diffed. An edit is a small,
    // deliberate, admin-only act on one order; matching rows up by hand would
    // add a class of bug (a line silently kept, a duplicate created) for no
    // benefit at this scale.
    const { error: delErr } = await sb.from("purchase_order_items").delete().eq("po_id", poId);
    if (delErr) throw delErr;
  } else {
    const poNumber = clip(input.poNumber, 40) ||
      await nextPoNumber(Number(orderDate.slice(0, 4)));
    const { data, error } = await sb
      .from("purchase_orders")
      .insert({ ...header, po_number: poNumber })
      .select("id")
      .single();
    if (error) throw error;
    poId = data.id as string;
  }

  const { error: itemErr } = await sb
    .from("purchase_order_items")
    .insert(rows.map((r) => ({ ...r, po_id: poId })));
  if (itemErr) throw itemErr;

  revalidatePath("/admin/procurement", "layout");
  return poId as string;
}

/** Status-only update, for moving an order along without opening the form. */
export async function setPurchaseOrderStatus(id: string, status: PoStatus) {
  await requireAdmin();
  if (!STATUSES.includes(status)) throw new Error("Unknown purchase order status");

  const sb = supabaseAdmin();
  const patch: Record<string, unknown> = { status };

  // Reaching a landed status without a recorded arrival date would leave the
  // order permanently un-assessable: no arrival date means no lead time and
  // no on-time judgement, so the supplier's record quietly loses a data
  // point. Stamping today is the honest default and stays editable.
  if (status === "arrived" || status === "received") {
    const { data } = await sb.from("purchase_orders").select("actual_arrival").eq("id", id).maybeSingle();
    if (data && !data.actual_arrival) {
      patch.actual_arrival = todayIso();
    }
  }

  const { error } = await sb.from("purchase_orders").update(patch).eq("id", id);
  if (error) throw error;

  // Reaching "received" is what puts the goods on the shelf: stock, the
  // catalog entry and the landed cost all follow from this one move. Done
  // after the status write so a failure here cannot leave the order stuck in
  // its old state, and safe to repeat -- the database rejects a second
  // receipt of the same line (see receivePurchaseOrder).
  if (status === "received") {
    const { receivePurchaseOrder } = await import("./receive");
    await receivePurchaseOrder(id);
  }
  revalidatePath("/admin/procurement", "layout");
}

export async function deletePurchaseOrder(id: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("purchase_orders").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/procurement", "layout");
}
