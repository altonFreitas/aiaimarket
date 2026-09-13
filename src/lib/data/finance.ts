import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ExpenseRow, RecurringRow } from "@/lib/finance";
import type { Cadence } from "@/lib/accounts";

/* Reading the cost side of the books.
 *
 * Every function here answers "the tables are not there yet" as a distinct
 * state rather than as an empty list. A finance screen that shows a profit
 * of zero because the migration has not been run is a screen that lies to
 * the person who most needs it to be right -- so the page says which file to
 * run instead.
 */

const MAX_EXPENSES = 5000;

export interface FinanceTables {
  ready: boolean;
  expenses: ExpenseRow[];
  recurring: RecurringRow[];
}

interface RawExpense {
  id: string;
  account: string;
  vendor: string | null;
  description: string | null;
  amount_usd: number | string | null;
  incurred_on: string;
  period_start: string | null;
  period_end: string | null;
  recurring_id: string | null;
  note: string | null;
}

function toExpense(r: RawExpense): ExpenseRow {
  return {
    id: r.id,
    account: r.account,
    vendor: r.vendor || "",
    description: r.description || "",
    amountUsd: Number(r.amount_usd) || 0,
    incurredOn: r.incurred_on,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    note: r.note || "",
  };
}

/** Every expense, and every recurring template, or a clear "not migrated".
 *
 * Read together because the screen needs both to say anything useful: the
 * expenses are what was spent, and the templates are what is still owed.
 * Which recurring periods have already been paid is derived from the
 * expenses themselves rather than stored, so the two can never disagree. */
export async function financeTables(): Promise<FinanceTables> {
  const sb = supabaseAdmin();
  try {
    const [spent, templates] = await Promise.all([
      sb.from("operating_expenses")
        .select("id, account, vendor, description, amount_usd, incurred_on, period_start, period_end, recurring_id, note")
        .order("incurred_on", { ascending: false })
        .limit(MAX_EXPENSES),
      sb.from("recurring_expenses")
        .select("id, account, vendor, description, amount, fx_rate, cadence, day_of_month, started_on, ended_on")
        .order("vendor"),
    ]);

    // Either table missing means the migration has not been run. Reported as
    // such, never as "no costs".
    if (spent.error || templates.error) {
      return { ready: false, expenses: [], recurring: [] };
    }

    return {
      ready: true,
      expenses: ((spent.data as RawExpense[]) || []).map(toExpense),
      recurring: ((templates.data as Record<string, unknown>[]) || []).map((r) => ({
        id: r.id as string,
        account: r.account as string,
        vendor: (r.vendor as string) || "",
        description: (r.description as string) || "",
        // recurring_expenses has no generated column: it is a template, and
        // what it will cost in USD is only knowable when it is actually
        // paid. This is the estimate the screen shows.
        amountUsd: (Number(r.amount) || 0) * (Number(r.fx_rate) || 1),
        cadence: r.cadence as Cadence,
        dayOfMonth: Number(r.day_of_month) || 1,
        startedOn: r.started_on as string,
        endedOn: (r.ended_on as string) || null,
      })),
    };
  } catch {
    return { ready: false, expenses: [], recurring: [] };
  }
}

/** Which "<recurringId>|<periodStart>" pairs have already been recorded.
 *
 * Derived from the expenses rather than stored, so "is this paid" has
 * exactly one answer and it is the ledger's. */
export async function paidRecurringPeriods(): Promise<Set<string>> {
  const sb = supabaseAdmin();
  try {
    const { data, error } = await sb
      .from("operating_expenses")
      .select("recurring_id, period_start")
      .not("recurring_id", "is", null)
      .not("period_start", "is", null);
    if (error) return new Set();
    return new Set(
      (data || []).map((r) => `${r.recurring_id}|${r.period_start}`));
  } catch { return new Set(); }
}

/** Delivery fees collected, and money refunded, over non-cancelled orders.
 *
 * Both are real cash movements the sales module deliberately leaves out of
 * "revenue" -- the fee because it is a pass-through to whoever delivers, and
 * a refund because it is not a negative sale. The profit and loss has to
 * account for them anyway, because they moved. */
export async function cashSideTotals(): Promise<{ deliveryFees: number; refunds: number }> {
  const sb = supabaseAdmin();
  let deliveryFees = 0;
  let refunds = 0;

  try {
    const { data } = await sb
      .from("orders").select("fee, status").neq("status", "cancelled").limit(20000);
    for (const o of data || []) deliveryFees += Number(o.fee) || 0;
  } catch { /* a shop with no orders yet */ }

  try {
    // SETTLED refunds only. refunded_at is null while a card refund is
    // agreed and not yet made at the gateway, and counting that as money
    // gone would be the same lie supabase/refund-settlement.sql exists to
    // stop the database telling.
    const { data, error } = await sb
      .from("order_returns").select("refund_total").not("refunded_at", "is", null);
    if (!error) for (const r of data || []) refunds += Number(r.refund_total) || 0;
  } catch { /* returns.sql not run */ }

  return {
    deliveryFees: Math.round(deliveryFees * 100) / 100,
    refunds: Math.round(refunds * 100) / 100,
  };
}
