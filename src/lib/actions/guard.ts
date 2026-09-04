import "server-only";
import { currentActor, type AdminActor } from "@/lib/session";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasSellerTotpSession } from "@/lib/sellerTotpSession";
import { canSee, canWrite, type SectionKey } from "@/lib/adminSections";
import {
  normalizeFeatures, sellerCanUse, type SellerFeatureKey,
} from "@/lib/sellerFeatures";
import { getCurrentSellerOrRedirect } from "@/lib/data/seller";
import { redirect } from "next/navigation";
import { PermissionError } from "@/lib/permissionError";
import type { Seller } from "@/lib/types";

/** Every admin server action must call this before touching the
 * service-role client. Throws, which surfaces as a generic error to any
 * caller that isn't an authenticated admin request.
 *
 * IT ALSO REFUSES READ-ONLY ACCOUNTS. That is the whole of "reader",
 * enforced in one function rather than in seventy-odd places, and it is
 * why this is the default rather than an opt-in: an action written next
 * year by someone who has never heard of roles calls requireAdmin() out of
 * habit and is locked down correctly without knowing it. An action that
 * genuinely only reads has to say so, out loud, by calling
 * requireAdminRead() instead -- which is a deliberate, visible, greppable
 * decision rather than an omission.
 *
 * Returns WHO is acting, so an action can record it without a second
 * lookup. Callers that only need the gate can keep ignoring the result. */
export async function requireAdmin(): Promise<AdminActor> {
  const actor = await requireAdminRead();
  if (!canWrite(actor)) {
    // PermissionError, not Error: this is the guard answering "no", and it
    // is logged as one line rather than as a crash with a code frame
    // pointing at the very check that is doing its job. The message is the
    // one the person sees.
    throw new PermissionError(
      "Your account has read-only access, so nothing was saved.",
      `${actor.label} (read-only) tried to change something`
    );
  }
  return actor;
}

/** Signed in, of any role. For the handful of admin actions that only
 * read -- an export, a lookup -- where refusing a reader would be refusing
 * them the thing they are for.
 *
 * Use this ONLY where nothing is written. If in doubt it is requireAdmin(),
 * because the cost of guessing wrong here is a reader who can change
 * things, and the cost of guessing wrong there is an error message. */
export async function requireAdminRead(): Promise<AdminActor> {
  const actor = await currentActor();
  if (!actor) throw new Error("Not authenticated");
  return actor;
}

/** Every admin PAGE calls this. Refuses anyone whose account does not hold
 * that section, so a URL typed straight into the address bar meets the
 * same rule that hid the link from the navigation.
 *
 * Pages read; they do not write. So this deliberately does not care about
 * the role -- a reader opening a page they hold is exactly what a reader
 * is for. The buttons on that page are stopped by requireAdmin(), above.
 *
 * Redirects rather than throws. A thrown error in a page renders the error
 * boundary: a stack-trace screen with no navigation, which tells somebody
 * who mistyped a URL that the admin is broken rather than that this part
 * is not theirs. /admin/no-access is a plain sentence with the nav still
 * above it, so they can go somewhere that is.
 *
 * A missing call here is caught by tests/adminSections.test.ts, which
 * reads every page.tsx under src/app/admin and fails if one does not
 * guard itself. */
export async function requireSection(section: SectionKey): Promise<AdminActor> {
  const actor = await requireAdminRead();
  if (!canSee(actor, section)) redirect("/admin/no-access");
  return actor;
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

/** Every seller PAGE that is not one of the four included screens calls
 * this. It refuses a store that has not been granted that feature, so a
 * URL typed straight into the address bar meets the same rule that kept
 * the tab out of their navigation.
 *
 * Redirects rather than throws, for the same reason requireSection() does:
 * a thrown error in a page renders a stack-trace screen with no navigation,
 * which tells a seller their shop is broken rather than that this part is
 * not included in what they have. /seller/no-access is a plain sentence
 * with the tabs still above it.
 *
 * Returns the seller, so the page can go straight on to reading their data
 * without a second lookup.
 *
 * A missing call here is caught by tests/sellerFeatures.test.ts, which
 * reads every page.tsx under src/app/seller and fails if one that belongs
 * to a sellable feature does not guard itself. */
export async function requireSellerFeature(feature: SellerFeatureKey): Promise<Seller> {
  const seller = await getCurrentSellerOrRedirect();
  // Suspended or still pending: not a features question. Those screens are
  // gated by SellerStatusGate, which explains the status; falling through
  // to "not included in your plan" would be the wrong sentence entirely.
  if (seller.status !== "approved") redirect("/seller/dashboard");
  if (!sellerCanUse(normalizeFeatures(seller.features), feature)) {
    redirect("/seller/no-access");
  }
  return seller;
}
