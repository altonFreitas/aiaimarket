import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { activeProvider } from "@/lib/notify/registry";
import { dispatchNotification } from "@/lib/notify/service";
import { reportError, reportWarning } from "@/lib/observability";

/** Sending the messages the shop has already promised.
 *
 * Both queues -- order notifications and product announcements -- have
 * always written their row before attempting anything, so a failed send
 * leaves something behind. What was missing was anything that comes back for
 * it. The send happened in the request that queued it, which is wrong in two
 * ways:
 *
 *   a serverless function can be frozen the moment its response is written,
 *   so a send that was not awaited may never run at all -- and nothing
 *   anywhere is in an error state, the row just says `queued` for ever;
 *
 *   and queueProductAlerts awaited one HTTP call PER RECIPIENT inside the
 *   shop's "add product". Five hundred customers meant five hundred
 *   sequential calls before the save returned.
 *
 * So the queue is drained here instead. Wire it up in vercel.json:
 *
 *   { "path": "/api/cron/send-queued", "schedule": "*\/5 * * * *" }
 *
 * Every five minutes rather than hourly: a buyer told their order is on its
 * way an hour later has been told nothing useful. The order queue still
 * tries immediately as well -- this is the safety net under that, not a
 * replacement for it.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How many messages one run will send.
 *
 * Bounded by the runtime, not by taste: maxDuration is 60 seconds and a
 * gateway that is having a bad day can take a second per message. Leftovers
 * are not lost -- they are still queued, and the next run is five minutes
 * away. */
const BATCH = 40;

/** How many times a message is tried before it is left for a person.
 *
 * A number that does not answer today will not answer on the four hundredth
 * attempt either, and every one of those attempts is billed. Three tries
 * spread over at least half an hour, then it waits in the admin queue where
 * somebody can look at it. */
const MAX_ATTEMPTS = 3;

/** How long a claim is honoured, and therefore the gap between retries. */
const STALE_MINUTES = 15;

const QUEUES = ["notifications", "customer_alerts"] as const;
type Queue = (typeof QUEUES)[number];

interface ClaimedRow { id: string; to_phone: string; body: string }

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  // Fail closed. Without a secret this endpoint would let anyone make the
  // shop send every queued message, which costs the shop money.
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Drains one queue, and says how far it got. */
async function drain(queue: Queue, budget: number): Promise<{
  claimed: number; sent: number; failed: number; skipped?: string;
}> {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("claim_queued_messages", {
    p_queue: queue,
    p_limit: budget,
    p_stale_minutes: STALE_MINUTES,
    p_max_attempts: MAX_ATTEMPTS,
  });

  if (error) {
    /* A shop that has not run supabase/message-queue.sql has no such
       function -- and also has nothing draining its queues, which is the
       state this endpoint exists to change. Reported as a skip rather than
       a failure, the same way release-reservations treats its own
       migration, so a half-migrated shop does not page anybody at five
       past every hour. */
    const code = (error as { code?: string }).code || "";
    if (code === "42883" || code === "PGRST202") {
      return { claimed: 0, sent: 0, failed: 0, skipped: "migration not run" };
    }
    reportError(error, { scope: "send-queued", queue });
    return { claimed: 0, sent: 0, failed: 0, skipped: "claim failed" };
  }

  const rows = (data as ClaimedRow[]) || [];
  let sent = 0;
  let failed = 0;

  /* ONE AT A TIME, on purpose. Every gateway this app speaks to rate-limits,
     and forty messages fired at once is how a shop gets a 429 for all forty
     rather than a slow forty. The rows are claimed for fifteen minutes; a
     run has sixty seconds; there is no rush. */
  for (const row of rows) {
    const ok = await dispatchNotification(row.id, row.to_phone, row.body, queue);
    if (ok) sent++;
    else failed++;
  }
  return { claimed: rows.length, sent, failed };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    reportWarning("Rejected unauthenticated cron request", { scope: "send-queued" });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  /* NOTHING IS CLAIMED WITHOUT A WAY TO SEND IT. Claiming increments the
     attempt counter, so draining with no gateway configured would burn all
     three attempts on every queued message in about ten minutes and leave a
     shop in manual mode with a queue full of rows marked as tried three
     times and never actually sent. */
  if (!activeProvider()) {
    return NextResponse.json({ skipped: "no messaging gateway configured" });
  }

  const out: Record<string, unknown> = {};
  let budget = BATCH;
  for (const queue of QUEUES) {
    if (budget <= 0) {
      out[queue] = { claimed: 0, sent: 0, failed: 0, skipped: "no budget left" };
      continue;
    }
    const result = await drain(queue, budget);
    /* The order queue goes first and spends what it needs: somebody is
       waiting on an order message, and nobody is waiting on an
       advertisement. */
    budget -= result.claimed;
    out[queue] = result;
  }

  return NextResponse.json(out);
}
