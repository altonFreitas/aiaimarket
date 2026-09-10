import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/* HOW LONG A PAYMENT PROOF STAYS READABLE.
 *
 * Long enough to open the page and look at the image; short enough that a
 * URL which escapes -- into a screenshot, a support thread, a browser
 * history synced to somebody's other laptop -- is worthless by the time
 * anyone finds it. A person reading an order does so in a minute; fifteen
 * covers a slow connection and a page left open while they answer the
 * phone.
 *
 * The bucket itself is private (supabase/schema.sql), so nothing here
 * decides WHO may look -- the admin guard and the ref+phone check already
 * did that, above every caller of this module. This only decides how long
 * the answer stays true. */
export const PROOF_URL_SECONDS = 15 * 60;

/* THE FALLBACK, for a database that has not run supabase/proof-path.sql.
 *
 * There is no proof_path column to re-mint from, so the stored URL is the
 * only record of the file and it has to outlive the page that wrote it.
 * Thirty days rather than the 365 it used to be: still far too long to be
 * comfortable, and 12x less exposure, on a shop that gets the real fix the
 * moment the migration runs. */
export const PROOF_URL_FALLBACK_SECONDS = 30 * 24 * 60 * 60;

/** A short-lived URL for one stored proof, or null if it cannot be made. */
export async function freshProofUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  try {
    const sb = supabaseAdmin();
    const { data } = await sb.storage
      .from("payment-proofs").createSignedUrl(path, PROOF_URL_SECONDS);
    return data?.signedUrl || null;
  } catch {
    // A missing file, a storage outage. The page shows the order without
    // the image rather than failing -- everything else on it is still the
    // answer somebody came for.
    return null;
  }
}

/** Replaces a stored proof_url with one minted now.
 *
 * Only when there is a path to mint from. On a row written before
 * supabase/proof-path.sql (or on a database that has not run it), the
 * stored URL is all there is and is left exactly as it was -- otherwise
 * migrating would blank out every proof already uploaded. */
export async function withFreshProofUrl<T extends { proof_path?: string | null; proof_url?: string | null }>(
  order: T | null,
): Promise<T | null> {
  if (!order?.proof_path) return order;
  const url = await freshProofUrl(order.proof_path);
  return { ...order, proof_url: url };
}
