"use server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSection } from "./guard";
import { audit } from "@/lib/audit";
import { SUPPLIER_RETURN_REASONS } from "@/lib/returns";

/* SENDING GOODS BACK TO A SUPPLIER.
 *
 * The stock half is the database's job: supplier_return_items has a trigger
 * that writes a negative ledger movement for every line that was actually on
 * the shelf, so products.qty still has exactly one writer. What belongs here
 * is the part the database cannot see -- who did it, and that the claim is
 * for a real supplier.
 *
 * Guarded on procurement, not sales. A claim against a supplier carries that
 * supplier's terms and the shop's cost price, which is the procurement
 * section's business and nobody else's.
 */

const MAX_TEXT = 200;
const MAX_NOTE = 1000;
const MAX_ATTEMPTS = 5;
/** A single claim larger than this is almost certainly a decimal point in
 * the wrong place. A ceiling on data entry, not a policy about what a shop
 * may claim. */
const MAX_CREDIT = 1_000_000;

const clip = (v: string | undefined | null, max: number) =>
  (v || "").trim().slice(0, max);

function reference(year: number): string {
  const n = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
  return `SRT${year}${n}`;
}

export interface SupplierReturnLineInput {
  productId?: string | null;
  productName: string;
  qty: number;
  unitCost?: number;
  /** False for goods quarantined on arrival, which never entered stock and
   * must not be taken out of it a second time. */
  fromStock?: boolean;
}

export interface SupplierReturnInput {
  supplierId: string;
  poId?: string | null;
  reason: string;
  note?: string;
  currency?: string;
  fxRate?: number;
  creditExpected: number;
  shippedOn?: string | null;
  lines: SupplierReturnLineInput[];
}

export async function recordSupplierReturn(input: SupplierReturnInput): Promise<string> {
  const actor = await requireSection("procurement");
  const sb = supabaseAdmin();

  if (!(SUPPLIER_RETURN_REASONS as readonly string[]).includes(input.reason)) {
    throw new Error("Choose why the goods are going back.");
  }

  const lines = (input.lines || [])
    .map((l) => ({
      productId: l.productId || null,
      productName: clip(l.productName, MAX_TEXT),
      qty: Number(l.qty) || 0,
      unitCost: Math.max(0, Number(l.unitCost) || 0),
      fromStock: l.fromStock !== false,
    }))
    .filter((l) => l.qty > 0 && (l.productId || l.productName));
  if (!lines.length) throw new Error("A return needs at least one line.");

  const { data: supplier } = await sb
    .from("suppliers").select("id, name").eq("id", input.supplierId).maybeSingle();
  if (!supplier) throw new Error("That supplier no longer exists.");

  const credit = Math.round(Math.max(0, Number(input.creditExpected) || 0) * 100) / 100;
  if (credit > MAX_CREDIT) throw new Error("That amount looks wrong — check it and try again.");
  const fxRate = Number(input.fxRate ?? 1);
  if (!Number.isFinite(fxRate) || fxRate <= 0) {
    throw new Error("The exchange rate has to be more than zero.");
  }

  // Recording a supplier return IS sending the parcel, so a return with no
  // date given left today. There is no separate "picked" step in this shop,
  // and a claim whose clock starts at some later click ages wrongly on the
  // one list whose whole purpose is to show what has gone unchased.
  const shippedOn = input.shippedOn || new Date().toISOString().slice(0, 10);

  const year = new Date().getFullYear();
  let created: { id: string; ref: string } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !created; attempt++) {
    const { data, error } = await sb.from("supplier_returns").insert({
      supplier_id: input.supplierId,
      po_id: input.poId || null,
      ref: reference(year),
      reason: input.reason,
      note: clip(input.note, MAX_NOTE),
      currency: clip(input.currency, 3).toUpperCase() || "USD",
      fx_rate: fxRate,
      credit_expected: credit,
      status: "sent",
      shipped_on: shippedOn,
      created_by: actor.label,
    }).select("id, ref").single();

    if (!error) { created = data as { id: string; ref: string }; break; }
    if ((error as { code?: string }).code === "42P01") {
      throw new Error("Run supabase/supplier-returns.sql first — the tables are missing.");
    }
    // 23505 is a duplicate reference; anything else is a real failure.
    if ((error as { code?: string }).code !== "23505") throw error;
  }
  if (!created) throw new Error("Could not allocate a return reference.");

  // The trigger on this table takes every line that was on the shelf back
  // out through the ledger.
  const { error: itemsErr } = await sb.from("supplier_return_items").insert(
    lines.map((l) => ({
      return_id: created!.id,
      product_id: l.productId,
      product_name: l.productName,
      qty: l.qty,
      unit_cost: l.unitCost,
      from_stock: l.fromStock,
    })));
  if (itemsErr) {
    // Leave no half-return behind: without its lines the row is a claim for
    // nothing, and it would still sit on the chase list forever.
    await sb.from("supplier_returns").delete().eq("id", created.id);
    throw itemsErr;
  }

  const units = lines.reduce((a, l) => a + l.qty, 0);
  await audit(actor, {
    action: "supplier_return.record", entity: "supplier_return", entityId: created.id,
    summary: `${actor.label} sent ${units} unit(s) back to ${supplier.name} (${created.ref})`,
    meta: {
      ref: created.ref, supplier: supplier.name, reason: input.reason,
      units, creditExpected: credit, currency: input.currency || "USD",
    },
  });

  revalidatePath("/admin/returns");
  revalidatePath("/admin/procurement");
  revalidatePath("/admin/stock");
  return created.id;
}

/** The supplier paid, or issued a credit note.
 *
 * Recorded separately from raising the claim, and that separation is the
 * point: a claim agreed is not a claim settled, and a screen that treats
 * them as one tells the shop it has money it does not have. The database
 * moves the status to 'credited' once the full amount has landed. */
export async function recordSupplierCredit(input: {
  returnId: string;
  /** In the claim's own currency, like credit_expected. */
  amount: number;
  creditedOn?: string;
}): Promise<void> {
  const actor = await requireSection("procurement");
  const sb = supabaseAdmin();

  const { data: row } = await sb
    .from("supplier_returns")
    .select("id, ref, status, credit_expected, credit_received, supplier:suppliers(name)")
    .eq("id", input.returnId).maybeSingle();
  if (!row) throw new Error("That return no longer exists.");
  if (row.status === "cancelled") throw new Error("That return was cancelled.");

  const amount = Math.round(Math.max(0, Number(input.amount) || 0) * 100) / 100;
  if (amount > MAX_CREDIT) throw new Error("That amount looks wrong — check it and try again.");

  const { error } = await sb.from("supplier_returns").update({
    credit_received: amount,
    // Null when nothing has arrived: "credited on" with a zero beside it
    // would read as settled-for-nothing rather than as still-open.
    credited_at: amount > 0 ? (input.creditedOn || new Date().toISOString()) : null,
  }).eq("id", input.returnId);
  if (error) throw error;

  const expected = Number(row.credit_expected) || 0;
  const short = Math.round((expected - amount) * 100) / 100;
  await audit(actor, {
    action: "supplier_return.credit", entity: "supplier_return", entityId: input.returnId,
    summary: short > 0
      ? `${actor.label} recorded ${amount.toFixed(2)} against ${row.ref} — ${short.toFixed(2)} short`
      : `${actor.label} recorded ${amount.toFixed(2)} against ${row.ref}, settled in full`,
    meta: { ref: row.ref, expected, received: amount, shortfall: Math.max(0, short) },
  });

  revalidatePath("/admin/returns");
}

/** The supplier refused the claim, or the shop withdrew it.
 *
 * Neither deletes the row. A claim that was fought and lost is the most
 * useful thing this table holds about a supplier, and one that vanishes
 * teaches the shop nothing before it orders from them again. */
export async function closeSupplierReturn(input: {
  returnId: string;
  status: "rejected" | "cancelled";
  note?: string;
}): Promise<void> {
  const actor = await requireSection("procurement");
  const sb = supabaseAdmin();

  const { data: row } = await sb
    .from("supplier_returns").select("id, ref, note").eq("id", input.returnId).maybeSingle();
  if (!row) throw new Error("That return no longer exists.");

  const extra = clip(input.note, MAX_NOTE);
  const note = extra
    ? [row.note, extra].filter(Boolean).join("\n").slice(0, MAX_NOTE)
    : (row.note as string);

  const { error } = await sb.from("supplier_returns")
    .update({ status: input.status, note }).eq("id", input.returnId);
  if (error) throw error;

  await audit(actor, {
    action: "supplier_return.close", entity: "supplier_return", entityId: input.returnId,
    summary: `${actor.label} marked ${row.ref} ${input.status}`,
    meta: { ref: row.ref, status: input.status, note: extra },
  });

  revalidatePath("/admin/returns");
}
