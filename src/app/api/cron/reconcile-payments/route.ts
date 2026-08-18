import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { confirmPaymentFromProvider } from "@/lib/payments/service";
import { sendAlert, alertsConfigured } from "@/lib/alerts";
import { reportError, reportWarning } from "@/lib/observability";

/** Payment reconciliation.
 *
 * Webhooks get lost. A gateway has an outage, a deploy is mid-flight, a
 * network blips — and an order sits at "unpaid" while the buyer's money is
 * gone. That is the single worst state this store can be in, and nothing
 * detects it on its own, because the missing signal is the thing that would
 * have told you.
 *
 * So this asks, on a schedule: for every payment that started but never
 * reached a settled state, go and ask the gateway directly what happened.
 * Anything still unresolved after that gets escalated to a human.
 *
 * Wire it up in vercel.json:
 *
 *   { "crons": [{ "path": "/api/cron/reconcile-payments", "schedule": "0 * * * *" }] }
 *
 * Vercel Cron sends an Authorization: Bearer <CRON_SECRET> header
 * automatically when CRON_SECRET is set in the project's env.
 */

export const dynamic = "force-dynamic";
// Polling several payments serially against a remote gateway needs more
// than the default budget.
export const maxDuration = 60;

/** How long a payment may stay unresolved before it is worth chasing. Short
 * enough that a buyer is not left in limbo; long enough that a buyer who is
 * simply still typing their card details is not counted as a problem. */
const STALE_MINUTES = 15;
/** Bound the work per run so one bad day cannot produce an unbounded job. */
const MAX_PER_RUN = 50;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  // Fail closed. Without a secret this endpoint would let anyone trigger
  // gateway calls on our account.
  if (!secret) return false;

  const header = req.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    reportWarning("Rejected unauthenticated cron request", { scope: "reconcile-payments" });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();

  const { data: stale, error } = await sb
    .from("payments")
    .select("id, order_id, provider, provider_ref, status, amount_minor, currency, created_at")
    .in("status", ["initiated", "pending", "authorized"])
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) {
    reportError(error, { scope: "reconcile-payments" });
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  const rows = stale || [];
  let resolved = 0;
  const unresolved: string[] = [];

  for (const row of rows) {
    try {
      // Re-asks the gateway and funnels the answer through the same
      // applyProviderEvent() the webhook uses, so a payment settled here is
      // settled identically to one settled by a webhook.
      const result = await confirmPaymentFromProvider(row.id as string);
      if (result.applied) resolved++;
      else unresolved.push(`${row.id} (${row.status}, ${result.reason})`);
    } catch (err) {
      reportError(err, { scope: "reconcile-payments", paymentId: row.id });
      unresolved.push(`${row.id} (${row.status}, error)`);
    }
  }

  // An authorized payment that never captured is the one worth waking
  // someone for: the buyer's funds are on hold and the store has not taken
  // them. Report it distinctly rather than lumping it in with abandonments.
  const stuckAuthorized = rows.filter((r) => r.status === "authorized").length;

  if (unresolved.length && alertsConfigured()) {
    await sendAlert(
      `Loja AIAI — ${unresolved.length} payment(s) need review`,
      [
        `Checked ${rows.length} payment(s) older than ${STALE_MINUTES} minutes.`,
        `Resolved by asking the gateway: ${resolved}`,
        stuckAuthorized ? `Authorized but never captured: ${stuckAuthorized}` : "",
        "",
        ...unresolved.slice(0, 20),
        unresolved.length > 20 ? `…and ${unresolved.length - 20} more` : "",
        "",
        "Full list: select * from payments_needing_review;",
      ].filter(Boolean)
    );
  }

  return NextResponse.json({
    checked: rows.length,
    resolved,
    unresolved: unresolved.length,
    stuckAuthorized,
    alerted: Boolean(unresolved.length && alertsConfigured()),
  });
}
