import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Admin client — service-role key, bypasses RLS entirely.
 * Import this ONLY in server actions / route handlers that have already
 * verified the caller holds a valid admin session (see lib/session.ts).
 * Never import this file from a Client Component or expose it to the browser. */
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
