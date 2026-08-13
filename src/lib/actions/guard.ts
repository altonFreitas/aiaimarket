import "server-only";
import { isLoggedIn } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
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
 * session, not from anything the request body could claim. */
export async function requireSeller(): Promise<Seller> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const admin = supabaseAdmin();
  const { data: seller } = await admin.from("sellers").select("*").eq("user_id", user.id).maybeSingle();
  if (!seller) throw new Error("No seller profile for this account");
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
