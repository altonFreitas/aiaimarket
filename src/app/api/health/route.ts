import { NextResponse } from "next/server";

/* IS THIS CONTAINER ALIVE?
 *
 * Docker restarts a container whose health check fails, and something has
 * to answer that question. Nothing else here could: every page needs a
 * database, and the admin needs a session.
 *
 * IT DOES NOT TOUCH SUPABASE, and that is the decision worth explaining.
 * A health check that calls the database restarts the app when the
 * DATABASE is unwell -- which fixes nothing, drops every in-flight
 * request, and then does it again in thirty seconds. This shop is built
 * to survive a database that is missing tables or briefly unreachable
 * (every read tolerates it), so "can I reach Supabase" is a question for
 * the admin's schema panel, not for the supervisor that decides whether
 * to kill the process.
 *
 * IT RETURNS NO SETTING, only whether one is present. `revision` is the
 * commit the image was built from, which is how you tell whether the
 * deploy you just pushed is the one answering.
 *
 * Deliberately unauthenticated: a health check that needs a secret cannot
 * be used by the thing that needs it. Nothing here is worth having.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      revision: process.env.APP_REVISION || "unknown",
      uptime: Math.round(process.uptime()),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
