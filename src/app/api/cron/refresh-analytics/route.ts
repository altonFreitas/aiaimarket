import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { reportError, reportWarning } from "@/lib/observability";

/** Rebuilding the dashboard's figures.
 *
 * sales_daily is a materialized view: it holds the answer from the last
 * time somebody worked it out, which is the whole reason the dashboard can
 * stop shipping the order book to work it out again on every load. The cost
 * of that trade is that somebody has to do the working out, and this is
 * that somebody.
 *
 * Wire it up in vercel.json:
 *
 *   { "path": "/api/cron/refresh-analytics", "schedule": "20 * * * *" }
 *
 * HOURLY, AND AT TWENTY PAST. Hourly because the figures it feeds are
 * revenue, margin and units over days and months -- nobody decides anything
 * on the last five minutes of that -- and an admin who needs the last hour
 * exactly still has the order list, which is live. Twenty past because the
 * other three crons are on the hour, at half past and every five minutes,
 * and a rebuild competing with a payment reconciliation for the same minute
 * helps nobody.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  // Fail closed, like every other cron here. A rebuild is not destructive,
  // but it is work, and an open endpoint that does work is a way to spend
  // somebody's database.
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    reportWarning("Rejected unauthenticated cron request", { scope: "refresh-analytics" });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const sb = supabaseAdmin();
  const { error } = await sb.rpc("refresh_sales_daily");

  if (error) {
    /* A shop that has not run supabase/sales-rollup.sql has no such
       function -- and also no view for anything to read, so nothing is
       broken and nobody needs waking at twenty past every hour. The same
       treatment release-reservations gives its own missing function. */
    const code = (error as { code?: string }).code || "";
    if (code === "42883" || code === "PGRST202") {
      return NextResponse.json({ refreshed: false, skipped: "migration not run" });
    }
    reportError(error, { scope: "refresh-analytics" });
    return NextResponse.json({ error: "refresh failed" }, { status: 500 });
  }

  return NextResponse.json({ refreshed: true, ms: Date.now() - started });
}
