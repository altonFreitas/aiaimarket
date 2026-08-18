import "server-only";
import { createClient } from "@supabase/supabase-js";

/** A session-free anon client for PUBLIC catalog reads.
 *
 * supabaseServer() binds to the request's cookies so it can carry a logged-in
 * user's session. That is exactly right for anything user-scoped — and
 * exactly wrong here, for two reasons:
 *
 *  1. It cannot be cached. `unstable_cache` forbids cookies()/headers()
 *     inside its callback, because a cached value that depended on one
 *     visitor's cookies would then be served to everyone.
 *
 *  2. It is not needed. Every RLS policy covering the public catalog
 *     (products, categories, settings, hero_slides, approved sellers,
 *     ratings) is written against `true` or a column value — none of them
 *     reference auth.uid(). A session-free client sees identical rows.
 *
 * So the catalog reads use this, and become cacheable across requests
 * rather than re-querying Singapore for every visitor.
 *
 * Still the ANON key: RLS applies in full. This is not a privileged client.
 */
export function supabaseAnon() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
