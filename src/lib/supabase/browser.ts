import { createBrowserClient } from "@supabase/ssr";

/** Client-side Supabase client. Uses the public anon key — every read it
 * makes is gated by the RLS policies in supabase/schema.sql, so it can
 * never see archived products or other people's orders. */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
