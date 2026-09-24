import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { todayIso } from "@/lib/procurement";
import { normalizeSizeQty } from "@/lib/sizeStock";
import { scopeSellerId, scopeCanWrite, type ProcurementScope } from "@/lib/procurementScope";
import { attributesForType } from "@/lib/data/taxonomy";
import { checkLineTaxonomy, type LineTaxonomy } from "@/lib/taxonomy/lineTaxonomy";
import { writeTolerating } from "@/lib/missingColumn";
import type { Submitted } from "@/lib/taxonomy/validate";
import type { FormAttribute } from "@/lib/taxonomy/types";
import type { PoCategory, PoPaymentStatus, PoStatus } from "@/lib/types";

/* Buying, as the database sees it -- for whoever is doing the buying.
 *
 * WHY THIS IS NOT IN A "use server" FILE. Every export of a server-action
 * module is a callable endpoint, and every function here takes a
 * ProcurementScope as its first argument. Exported from an action file,
 * `savePurchaseOrderIn({kind:"seller",sellerId:"…"} , …)` would be a way for
 * anyone to write into anyone's purchasing book by naming them. So the
 * scope is decided by a guard in the action wrappers -- requireAdmin gives
 * the platform's, requireSellerFeature gives that seller's -- and never
 * arrives from a client.
 *
 * The owner's screens and a seller's call exactly the same code below. That
 * is deliberate: the alternative was a second copy of three hundred lines of
 * validation, which is how one of the two copies ends up accepting a
 * negative quantity a year from now.
 */


/* --------------------------- the scope itself --------------------------- */

/** The column value a row created in this scope carries, as a patch that
 * is simply absent for the platform -- so a database that has not run
 * supabase/seller-procurement.sql still accepts the owner's inserts. */
function sellerColumn(scope: ProcurementScope): Record<string, string> {
  const id = scopeSellerId(scope);
  return id ? { seller_id: id } : {};
}

/** Refuses before the write, rather than filtering the write.
 *
 * `.update(…).eq("id", x).eq("seller_id", me)` on somebody else's row
 * succeeds and changes nothing, which the person editing reads as "saved".
 * This makes it an error with a sentence attached instead.
 *
 * A row whose seller_id is undefined -- no such column yet -- reads as the
 * platform's, which on that database it is. */
async function assertOwns(
  scope: ProcurementScope, table: "suppliers" | "purchase_orders", id: string
): Promise<void> {
  const sb = supabaseAdmin();
  const { data } = await sb.from(table).select("seller_id").eq("id", id).maybeSingle();
  if (!data) throw new Error("Not found");
  if (!scopeCanWrite(scope, (data as { seller_id?: string | null }).seller_id)) {
    throw new Error("Not found");
  }
}

/** Both sets of screens read these tables, so both are refreshed by name.
 * Revalidating a path nothing is rendering costs nothing. */
function revalidateFor(scope: ProcurementScope): void {
  if (scope.kind === "seller") revalidatePath("/seller/procurement", "layout");
  else revalidatePath("/admin/procurement", "layout");
}

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

export async function saveSupplierIn(
  scope: ProcurementScope, input: SupplierInput
): Promise<string> {
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
    // Checked before the write, not filtered into it: an update that simply
    // matched nothing would report success and change nothing, and the
    // person editing would be looking at a form that had silently done
    // nothing. Refusing says so.
    await assertOwns(scope, "suppliers", input.id);
    const { error } = await sb.from("suppliers").update(row).eq("id", input.id);
    if (error) throw error;
    revalidateFor(scope);
    return input.id;
  }
  const { data, error } = await sb.from("suppliers")
    .insert({ ...row, ...sellerColumn(scope) }).select("id").single();
  if (error) throw error;
  revalidateFor(scope);
  return data.id as string;
}

/** Deactivates rather than deletes when the supplier has history.
 *
 * A supplier row is what explains where money went; removing one would
 * orphan that history, and the foreign key is ON DELETE RESTRICT precisely
 * so the database refuses. Deactivating keeps the record and takes them out
 * of the pickers, which is what "we don't buy from them any more" means. */
export async function deleteSupplierIn(scope: ProcurementScope, id: string) {
  await assertOwns(scope, "suppliers", id);
  const sb = supabaseAdmin();
  const { count } = await sb
    .from("purchase_orders")
    .select("id", { count: "exact", head: true })
    .eq("supplier_id", id);

  if (count && count > 0) {
    const { error } = await sb.from("suppliers").update({ active: false }).eq("id", id);
    if (error) throw error;
    revalidateFor(scope);
    return { deactivated: true, orders: count };
  }

  const { error } = await sb.from("suppliers").delete().eq("id", id);
  if (error) throw error;
  revalidateFor(scope);
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
  /** How many of each size: {"S":5,"M":10,"L":15}. When present it is what
   * qty was computed from, and what receipt splits into one ledger
   * movement per size. */
  sizeQty?: Record<string, number> | null;
  /** Who the goods are for, copied onto the product at receipt. */
  description?: string;
  /** What KIND of thing this line buys, from the taxonomy. Copied onto the
   * product at receipt, which is what gives the new listing its fields,
   * its Specifications panel and its place in the attribute filters. */
  productTypeId?: string | null;
  /** The answers to that type's questions. Checked against the type on the
   * server -- see lib/taxonomy/lineTaxonomy.ts. */
  attributeValues?: Submitted | null;
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

export async function savePurchaseOrderIn(
  scope: ProcurementScope, input: PurchaseOrderInput
): Promise<string> {
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
  /* A landed order with no arrival date can never be assessed afterwards --
   * no arrival means no lead time and no on-time judgement, so the
   * supplier's record quietly loses a data point. Stamping today is the
   * honest default and stays editable. The quick-status buttons have always
   * done this; saving the form had not, so the SAME move made through the
   * dropdown produced a different row. */
  const landed = input.status === "arrived" || input.status === "received";
  const today = todayIso();
  // Not stamped onto an order dated in the future: it would be an arrival
  // before the purchase, which the check just above rejects when a person
  // types it and should not slip in behind them.
  const arrival = actual ?? (landed && today >= orderDate ? today : null);

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
  // The supplier has to be one of THIS scope's. Otherwise a seller could
  // file an order against the owner's factory -- and the owner's supplier
  // list would grow orders it never placed.
  const { data: supplier } = await sb.from("suppliers")
    .select("id, seller_id").eq("id", input.supplierId).maybeSingle();
  if (!supplier || !scopeCanWrite(scope, supplier.seller_id)) {
    throw new Error("Supplier not found");
  }

  const header = {
    supplier_id: input.supplierId,
    buyer: clip(input.buyer, MAX_NAME),
    order_date: orderDate,
    expected_arrival: expected,
    actual_arrival: arrival,
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

  /* THE PRODUCT TYPES THE LINES NAME, READ FROM THE DATABASE.
     Once per distinct type rather than once per line: an order restocking
     twenty shirt colours names one product type twenty times, and the
     attributes it asks for are the same twenty times.

     null in the map means "asked for, and there is no such product type",
     which checkLineTaxonomy refuses. That is different from an empty list,
     which is a real type nobody has configured attributes for yet.

     The whole lookup is wrapped because a shop that has not run
     supabase/taxonomy.sql has no product_types table -- there, every line
     is treated as naming a type that does not exist, and since no form on
     such a shop can offer one, no line names one. */
  const typeIds = [...new Set(lines
    .map((l) => (l.productTypeId || "").trim()).filter(Boolean))];
  const attrsByType = new Map<string, FormAttribute[] | null>();
  for (const id of typeIds) {
    try {
      const { data } = await sb.from("product_types").select("id").eq("id", id).maybeSingle();
      attrsByType.set(id, data
        ? await attributesForType(id, { includeAdminOnly: true })
        : null);
    } catch { attrsByType.set(id, null); }
  }

  /* Held beside the rows rather than inside them, because the two columns
     they become may not exist yet -- see the insert below. */
  const taxonomy: LineTaxonomy[] = [];

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
    const category = CATEGORIES.includes(l.category) ? l.category : ("other" as PoCategory);
    /* Throws, with the line named. A purchase order can carry twenty lines
       and "That field does not belong to this product type" would not say
       which one to go and look at. */
    taxonomy.push(checkLineTaxonomy(
      category === "goods_for_resale",
      l.productTypeId,
      l.attributeValues,
      attrsByType.get((l.productTypeId || "").trim()) ?? null,
      l.productName || "line"));

    return {
      product_id: l.productId || null,
      product_name: clip(l.productName, MAX_NAME),
      category,
      qty,
      unit_price: unitPrice,
      catalog_category_id: l.catalogCategoryId || null,
      sell_price: sellPrice,
      sizes: clip(l.sizes, MAX_NAME),
      /* Normalised on the way in, not trusted from the browser: a
         breakdown carrying -3 or 2.5 would reach the ledger, and the
         ledger is the shop's record of what is on the shelf. */
      size_qty: normalizeSizeQty(l.sizeQty),
      description: clip(l.description, MAX_TEXT),
    };
  });

  let poId = input.id;
  if (poId) {
    await assertOwns(scope, "purchase_orders", poId);
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
      .insert({ ...header, ...sellerColumn(scope), po_number: poNumber })
      .select("id")
      .single();
    if (error) throw error;
    poId = data.id as string;
  }

  /* THE TWO NEWEST COLUMNS, DROPPED IF THEY ARE NOT THERE YET.
     This project deploys the code and runs the SQL by hand afterwards, and
     Postgres fails the WHOLE statement over one unknown column name -- so
     without this, pulling the code that can buy a product type would stop
     a shop saving ANY purchase order until it had pasted po-taxonomy.sql.
     Everything the buyer typed still saves; the type and its answers start
     being kept the moment the migration runs. */
  const { error: itemErr } = await writeTolerating(
    { product_type_id: null, attribute_values: {} },
    (extra) => sb.from("purchase_order_items").insert(
      rows.map((r, i) => ({
        ...r,
        po_id: poId,
        ...("product_type_id" in extra
          ? { product_type_id: taxonomy[i].productTypeId } : {}),
        ...("attribute_values" in extra
          ? { attribute_values: taxonomy[i].values } : {}),
      }))),
  );
  if (itemErr) throw itemErr;

  /* SAVING AN ORDER AS "RECEIVED" RECEIVES IT.
   *
   * There are two ways to move an order along -- the quick-status buttons
   * at the top of the form, and the Purchase status dropdown inside it --
   * and only the first of them used to reach this. So a shop that picked
   * "received" in the dropdown and pressed Save got an order that SAID the
   * goods had landed while the shelf never moved: no stock, no catalog
   * entry for a product bought without one, no landed cost. The product
   * stayed "Out of stock" and the home page never changed, which is exactly
   * what it looked like from the outside -- nothing had happened, because
   * nothing had.
   *
   * The same call the buttons make, from the other door. Safe to repeat:
   * the unique index on stock_movements(po_item_id, size) means a line
   * already received is reported rather than added twice.
   *
   * Last, after the lines are written, because it reads them back. A
   * failure here therefore cannot lose the order -- it is saved by the time
   * this runs, and the caller can move it to "received" again. */
  if (input.status === "received") {
    const { applyReceipt } = await import("./receiving");
    await applyReceipt(poId as string, scopeSellerId(scope));
  }

  revalidateFor(scope);
  return poId as string;
}

/** Status-only update, for moving an order along without opening the form. */
export async function setPurchaseOrderStatusIn(
  scope: ProcurementScope, id: string, status: PoStatus
) {
  await assertOwns(scope, "purchase_orders", id);
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
    const { applyReceipt } = await import("./receiving");
    await applyReceipt(id, scopeSellerId(scope));
  }
  revalidateFor(scope);
}

export async function deletePurchaseOrderIn(scope: ProcurementScope, id: string) {
  await assertOwns(scope, "purchase_orders", id);
  const sb = supabaseAdmin();
  const { error } = await sb.from("purchase_orders").delete().eq("id", id);
  if (error) throw error;
  revalidateFor(scope);
}
