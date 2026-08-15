import "server-only";
import { isLoggedIn } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasSellerTotpSession } from "@/lib/sellerTotpSession";
import type { Seller } from "@/lib/types";

/** Every admin server action must call this before touching the
 * service-role client. Throws, which surfaces as a generic error to any
 * caller that isn't an authenticated admin request. */
export async function requireAdmin() {
  const ok = await isLoggedIn();
  if (!ok) throw new Error("Not authenticated");
}

/** Every seller-scoped server action must call this and use the
 * RETURNED seller's id for any query/write — never a seller id supplied
 * by the client. This is what actually enforces "a seller can never act
 * as another seller": the seller is resolved from the verified auth
 * session, not from anything the request body could claim.
 *
 * If this seller has opted into 2FA (totp_enabled), a valid Supabase
 * session alone isn't enough — the secondary loja_seller_totp_ok cookie
 * (set only after a correct TOTP code, see lib/actions/seller-totp.ts)
 * must also be present and match this exact seller. Supabase's own
 * session is created the instant the password check passes, before
 * there's any chance to pause for a second factor — this cookie is what
 * actually gates real access until that second factor is done. */
export async function requireSeller(): Promise<Seller> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const admin = supabaseAdmin();
  const { data: seller } = await admin.from("sellers").select("*").eq("user_id", user.id).maybeSingle();
  if (!seller) throw new Error("No seller profile for this account");

  if (seller.totp_enabled) {
    const ok = await hasSellerTotpSession(seller.id);
    if (!ok) throw new Error("Two-factor verification required");
  }

  return seller as Seller;
}

/** Same as requireSeller(), but also requires status === "approved" —
 * for anything a pending/rejected/suspended seller shouldn't be able to
 * do yet (creating products, viewing orders, etc., once those exist). */
export async function requireApprovedSeller(): Promise<Seller> {
  const seller = await requireSeller();
  if (seller.status !== "approved") throw new Error("Seller account is not approved");
  return seller;
}
