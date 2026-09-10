import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendAlert, alertsConfigured } from "@/lib/alerts";
import { reportError, reportWarning } from "@/lib/observability";

/** Giving back stock that nobody is coming for.
 *
 * placeOrder() now holds a buyer's units the moment they order, which is
 * what stops two people buying the same last one (see
 * supabase/stock-reservation.sql). The cost of that is a new way to lose
 * stock: an order placed for cash-on-delivery and then abandoned holds its
 * units forever, and the shop cannot sell what it still has.
 *
 * So a hold has a lifetime. This is the thing that enforces it.
 *
 * Wire it up in vercel.json:
 *
 *   { "path": "/api/cron/release-reservations", "schedule": "30 * * * *" }
 *
 * Half past the hour rather than on it, so it is not competing with
 * reconcile-payments for the same minute.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How long a buyer has to get an order confirmed before their hold
 * expires.
 *
 * Two days, not two hours. The shortest sensible window is set by the
 * slowest legitimate payment: a bank transfer made on a Friday evening is
 * not reconciled until Monday, and this store's own payment methods
 * include one literally called "fiar" -- on credit. A sweep tuned for a
 * card checkout would cancel real orders from real customers, which is a
 * worse failure than holding a unit too long.
 *
 * Override with RESERVATION_HOURS when a shop's rhythm is different. */
const DEFAULT_HOURS = 48;

function reservationHours(): number {
  const raw = Number(process.env.RESERVATION_HOURS);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_HOURS;
  return Math.floor(raw);
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  // Fail closed. Without a secret this endpoint would let anyone cancel
  // every unconfirmed order in the shop.
  if (!secret) return false;

  const header = req.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

interface ReleasedRow {
  order_id: string;
  order_ref: string;
  released: number;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    reportWarning("Rejected unauthenticated cron request", { scope: "release-reservations" });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const hours = reservationHours();
  const sb = supabaseAdmin();

  const { data, error } = await sb.rpc("release_stale_reservations", { p_hours: hours });

  if (error) {
    // A database that has not run supabase/stock-reservation.sql has no
    // such function and also has no reservations to release -- nothing is
    // wrong and nobody needs waking. Anything else is a real failure.
    const code = (error as { code?: string }).code || "";
    if (code === "42883" || code === "PGRST202") {
      return NextResponse.json({ released: 0, skipped: "migration not run" });
    }
    reportError(error, { scope: "release-reservations", hours });
    return NextResponse.json({ error: "release failed" }, { status: 500 });
  }

  const rows = (data as ReleasedRow[]) || [];
  const units = rows.reduce((a, r) => a + (Number(r.released) || 0), 0);

  /* Told, not silent. Cancelling somebody's order is a real act with a
   * real customer behind it, and a shop that discovers weeks later that a
   * sweep has been quietly cancelling orders every night is a shop that
   * stops trusting its own tools. Only when something actually happened --
   * an empty sweep is the healthy case and is not worth a message. */
  if (rows.length && alertsConfigured()) {
    await sendAlert(
      `Loja AIAI — ${rows.length} expired reservation(s) released`,
      [
        `Orders left unconfirmed for more than ${hours} hours, now cancelled.`,
        `${units} unit(s) returned to the shelf.`,
        "",
        ...rows.slice(0, 20).map((r) => `${r.order_ref} — ${r.released} unit(s)`),
        rows.length > 20 ? `…and ${rows.length - 20} more` : "",
        "",
        "If these were real orders, confirm them faster or raise RESERVATION_HOURS.",
      ].filter(Boolean)
    );
  }

  return NextResponse.json({
    hours,
    released: rows.length,
    units,
    refs: rows.map((r) => r.order_ref),
    alerted: Boolean(rows.length && alertsConfigured()),
  });
}
