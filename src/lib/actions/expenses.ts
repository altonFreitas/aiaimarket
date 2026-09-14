"use server";
import { revalidatePath } from "next/cache";
import { requireSection } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { isExpenseAccount, isCadence } from "@/lib/accounts";

/* RECORDING WHAT THE SHOP SPENDS.
 *
 * Guarded on the settings section: what a business pays its suppliers, its
 * staff and its bank is the most commercially sensitive data here -- more so
 * than margin, which can at least be guessed from prices.
 *
 * Everything is audited. An expense ledger nobody can check is a ledger, and
 * one anybody can quietly edit is a story.
 */

const MAX_TEXT = 200;
const MAX_NOTE = 1000;
/** A single operating cost larger than this is almost certainly a typo -- a
 * decimal point in the wrong place turns $25 into $2,500. A ceiling on
 * data entry, not a policy about what the shop may spend; raise it here if
 * a shop genuinely pays a bill this size. */
const MAX_AMOUNT = 1_000_000;

const clip = (v: string | undefined | null, max: number) =>
  (v || "").trim().slice(0, max);

function checkedAmount(raw: number): number {
  const amount = Math.round(Number(raw) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("The amount has to be more than zero.");
  }
  if (amount > MAX_AMOUNT) {
    throw new Error("That amount looks wrong — check it and try again.");
  }
  return amount;
}

function checkedRate(raw: number | undefined): number {
  const rate = Number(raw ?? 1);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("The exchange rate has to be more than zero.");
  }
  return rate;
}

export interface ExpenseInput {
  account: string;
  vendor: string;
  description?: string;
  amount: number;
  currency?: string;
  /** Multiply by this for USD. 1 when the cost was paid in dollars. */
  fxRate?: number;
  incurredOn: string;
  /** What the payment covers, for a subscription. */
  periodStart?: string | null;
  periodEnd?: string | null;
  note?: string;
  /** Set when confirming a recurring cost, which is what makes confirming
   * it twice impossible -- see the unique index in
   * supabase/operating-costs.sql. */
  recurringId?: string | null;
}

export async function recordExpense(input: ExpenseInput): Promise<string> {
  const actor = await requireSection("settings");
  if (!isExpenseAccount(input.account)) throw new Error("Choose an account for this cost.");
  const vendor = clip(input.vendor, MAX_TEXT);
  if (!vendor) throw new Error("Say who it was paid to.");

  const amount = checkedAmount(input.amount);
  const fxRate = checkedRate(input.fxRate);

  const sb = supabaseAdmin();
  const { data, error } = await sb.from("operating_expenses").insert({
    account: input.account,
    vendor,
    description: clip(input.description, MAX_TEXT),
    amount,
    currency: clip(input.currency, 8) || "USD",
    fx_rate: fxRate,
    incurred_on: input.incurredOn,
    period_start: input.periodStart || null,
    period_end: input.periodEnd || null,
    recurring_id: input.recurringId || null,
    note: clip(input.note, MAX_NOTE),
    created_by: actor.label,
  }).select("id").single();

  if (error) {
    // 23505 on the one-per-period index: this recurring cost was already
    // confirmed for this period. Two clicks on a slow connection, not a
    // failure -- and saying "already recorded" is the true answer.
    if ((error as { code?: string }).code === "23505") {
      throw new Error("That cost is already recorded for this period.");
    }
    // 42P01: the table is not there. Name the file rather than showing a
    // Postgres error to somebody trying to do their books.
    if ((error as { code?: string }).code === "42P01") {
      throw new Error("Run supabase/operating-costs.sql first — the expense tables are missing.");
    }
    throw error;
  }

  await audit(actor, {
    action: "expense.record", entity: "operating_expense", entityId: data?.id ?? null,
    summary: `${actor.label} recorded ${amount.toFixed(2)} ${input.currency || "USD"} to ${vendor} (${input.account})`,
    meta: { account: input.account, vendor, amount, currency: input.currency || "USD", fxRate },
  });

  revalidatePath("/admin/finance");
  revalidatePath("/admin");
  return data?.id as string;
}

export async function deleteExpense(id: string): Promise<void> {
  const actor = await requireSection("settings");
  const sb = supabaseAdmin();

  // READ BEFORE DELETE. This is a money record; the audit trail is the only
  // copy that survives, and "somebody removed a cost" with no idea which one
  // is not a trail.
  const { data: row } = await sb
    .from("operating_expenses")
    .select("id, account, vendor, amount, currency, amount_usd, incurred_on, description")
    .eq("id", id).maybeSingle();

  const { error } = await sb.from("operating_expenses").delete().eq("id", id);
  if (error) throw error;

  await audit(actor, {
    action: "expense.delete", entity: "operating_expense", entityId: id,
    summary: row
      ? `Removed a ${Number(row.amount_usd).toFixed(2)} cost to ${row.vendor} (${row.account})`
      : "Removed a cost that was no longer there",
    meta: { deleted: row ?? null },
  });

  revalidatePath("/admin/finance");
  revalidatePath("/admin");
}

/* ---------------------------------------------------------------------------
 * The things that bill again
 * ------------------------------------------------------------------------ */

export interface RecurringInput {
  account: string;
  vendor: string;
  description?: string;
  amount: number;
  currency?: string;
  fxRate?: number;
  cadence: string;
  dayOfMonth: number;
  startedOn: string;
  note?: string;
}

export async function addRecurring(input: RecurringInput): Promise<string> {
  const actor = await requireSection("settings");
  if (!isExpenseAccount(input.account)) throw new Error("Choose an account for this cost.");
  if (!isCadence(input.cadence)) throw new Error("Choose how often it bills.");
  const vendor = clip(input.vendor, MAX_TEXT);
  if (!vendor) throw new Error("Say who it is paid to.");

  const amount = checkedAmount(input.amount);
  const fxRate = checkedRate(input.fxRate);
  // 1..28, so February is never a special case and a bill due on the 31st
  // does not silently skip the short months.
  const day = Math.min(28, Math.max(1, Math.floor(Number(input.dayOfMonth) || 1)));

  const sb = supabaseAdmin();
  const { data, error } = await sb.from("recurring_expenses").insert({
    account: input.account,
    vendor,
    description: clip(input.description, MAX_TEXT),
    amount,
    currency: clip(input.currency, 8) || "USD",
    fx_rate: fxRate,
    cadence: input.cadence,
    day_of_month: day,
    started_on: input.startedOn,
    note: clip(input.note, MAX_NOTE),
  }).select("id").single();

  if (error) {
    if ((error as { code?: string }).code === "42P01") {
      throw new Error("Run supabase/operating-costs.sql first — the expense tables are missing.");
    }
    throw error;
  }

  await audit(actor, {
    action: "expense.recurring_add", entity: "recurring_expense", entityId: data?.id ?? null,
    summary: `${actor.label} added a ${input.cadence} cost of ${amount.toFixed(2)} to ${vendor}`,
    meta: { account: input.account, vendor, amount, cadence: input.cadence, dayOfMonth: day },
  });

  revalidatePath("/admin/finance");
  return data?.id as string;
}

/** Correct what a subscription says about itself.
 *
 * A typo in a vendor name -- "supabase" for "Supabase", "Claude code" for
 * "Claude Code" -- is not a cosmetic problem here: the name is the grouping
 * key in the profit-and-loss breakdown, so two spellings are two suppliers
 * and the shop cannot see what it actually spends with either.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH: the expenses already recorded from
 * this template. Those carry their own copy of the vendor and the amount,
 * taken at the moment the money left, and rewriting them would be rewriting
 * history -- the bill really did say what it said in March. Fixing the
 * template fixes what happens NEXT, which is the only thing a template can
 * honestly promise.
 *
 * The cadence and the start date are likewise left alone. Both decide which
 * periods are owed, and changing them under an expense already confirmed
 * against a period would orphan it -- see the unique index in
 * supabase/operating-costs.sql. */
export async function updateRecurring(input: {
  id: string;
  vendor: string;
  description?: string;
  account: string;
  amount: number;
}): Promise<void> {
  const actor = await requireSection("settings");
  if (!isExpenseAccount(input.account)) throw new Error("Choose an account for this cost.");
  const vendor = clip(input.vendor, MAX_TEXT);
  if (!vendor) throw new Error("Say who it is paid to.");
  const amount = checkedAmount(input.amount);

  const sb = supabaseAdmin();

  // Read before write: this is a money record, and "somebody renamed a
  // subscription" with no idea what it used to say is not a trail.
  const { data: before } = await sb
    .from("recurring_expenses")
    .select("id, vendor, description, account, amount")
    .eq("id", input.id).maybeSingle();
  if (!before) throw new Error("That subscription no longer exists.");

  const { error } = await sb.from("recurring_expenses").update({
    vendor,
    description: clip(input.description, MAX_TEXT),
    account: input.account,
    amount,
  }).eq("id", input.id);
  if (error) throw error;

  await audit(actor, {
    action: "expense.recurring_edit", entity: "recurring_expense", entityId: input.id,
    summary: before.vendor === vendor
      ? `${actor.label} edited the ${vendor} subscription`
      : `${actor.label} renamed "${before.vendor}" to "${vendor}"`,
    meta: {
      before: {
        vendor: before.vendor, description: before.description,
        account: before.account, amount: Number(before.amount),
      },
      after: { vendor, description: clip(input.description, MAX_TEXT),
               account: input.account, amount },
    },
  });

  revalidatePath("/admin/finance");
}

/** Stop a subscription without losing the record of having paid for it.
 *
 * Ended, not deleted: the history is worth more than the tidiness, and
 * deleting the template would orphan every expense that came from it. */
export async function endRecurring(id: string, endedOn: string): Promise<void> {
  const actor = await requireSection("settings");
  const sb = supabaseAdmin();

  const { data: row } = await sb
    .from("recurring_expenses").select("id, vendor, amount, cadence")
    .eq("id", id).maybeSingle();
  if (!row) throw new Error("That subscription no longer exists.");

  const { error } = await sb.from("recurring_expenses")
    .update({ ended_on: endedOn }).eq("id", id);
  if (error) throw error;

  await audit(actor, {
    action: "expense.recurring_end", entity: "recurring_expense", entityId: id,
    summary: `${actor.label} stopped the ${row.cadence} cost to ${row.vendor}`,
    meta: { vendor: row.vendor, amount: row.amount, endedOn },
  });

  revalidatePath("/admin/finance");
}

/** Confirm that a recurring cost was actually paid for a period.
 *
 * THIS is what turns a template into a cost. Nothing from
 * recurring_expenses reaches the profit and loss until somebody says the
 * money left -- a subscription that was cancelled, failed, or was billed at
 * a different price would otherwise sit in the accounts forever as a cost
 * that never happened. */
export async function confirmRecurring(input: {
  recurringId: string;
  periodStart: string;
  periodEnd: string;
  incurredOn: string;
  /** Overridable, because the bill is not always what the template says --
   * a price rise, a partial month, a currency move. */
  amount?: number;
}): Promise<string> {
  await requireSection("settings");
  const sb = supabaseAdmin();

  const { data: tpl } = await sb
    .from("recurring_expenses")
    .select("id, account, vendor, description, amount, currency, fx_rate")
    .eq("id", input.recurringId).maybeSingle();
  if (!tpl) throw new Error("That subscription no longer exists.");

  return await recordExpense({
    account: tpl.account as string,
    vendor: tpl.vendor as string,
    description: (tpl.description as string) || "",
    amount: input.amount ?? Number(tpl.amount),
    currency: (tpl.currency as string) || "USD",
    fxRate: Number(tpl.fx_rate) || 1,
    incurredOn: input.incurredOn,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    recurringId: input.recurringId,
  });
}
