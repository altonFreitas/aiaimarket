"use server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSeller } from "@/lib/actions/guard";
import { getOrCreateTotpSetup, confirmTotpSetup, verifyTotpCode, disableTotp, type TotpTarget } from "@/lib/totp";
import { grantSellerTotpSession, clearSellerTotpSession } from "@/lib/sellerTotpSession";
import { notifySellerLogin } from "@/lib/actions/notify";
import { revalidatePath } from "next/cache";

function targetFor(sellerId: string): TotpTarget {
  return { table: "sellers", idValue: sellerId };
}

/** Called from /seller/settings. requireSeller() works fine here even
 * before 2FA is set up — its totp check only applies once
 * totp_enabled is already true, so a seller turning it on for the
 * first time isn't blocked by the very feature they're enabling. */
export async function startSellerTotpSetup() {
  const seller = await requireSeller();
  return getOrCreateTotpSetup(targetFor(seller.id), seller.email);
}

export async function confirmSellerTotpSetupAction(code: string) {
  const seller = await requireSeller();
  const confirmed = await confirmTotpSetup(targetFor(seller.id), code, seller.email);
  if (confirmed) {
    // Enabling it shouldn't force an immediate re-login — grant the
    // second-factor cookie right away, same as the admin flow granting
    // a session as soon as setup completes.
    await grantSellerTotpSession(seller.id);
    revalidatePath("/seller/settings");
  }
  return confirmed;
}

/** Requires requireSeller() to already succeed, which — since it's
 * called from the settings page a seller can only reach after a full
 * login (password + TOTP, if already enabled) — is a reasonable bar for
 * turning 2FA back off, without a separate password re-prompt. */
export async function disableSellerTotpAction() {
  const seller = await requireSeller();
  await disableTotp(targetFor(seller.id));
  await clearSellerTotpSession();
  revalidatePath("/seller/settings");
}

/** The login-time step: called from /account when a seller has 2FA
 * enabled but hasn't passed it yet this session (see app/account/page.tsx
 * and lib/actions/guard.ts). Deliberately does NOT use requireSeller()
 * — that function's own totp check is exactly what this action exists
 * to satisfy, so using it here would be circular. Resolves the seller
 * from the Supabase session directly instead. */
export async function verifySellerLoginTotp(code: string): Promise<{ ok: boolean; locked: boolean }> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, locked: false };

  const admin = supabaseAdmin();
  const { data: seller } = await admin.from("sellers").select("id, email, store_name").eq("user_id", user.id).maybeSingle();
  if (!seller) return { ok: false, locked: false };

  const result = await verifyTotpCode(targetFor(seller.id), code, seller.email);
  if (result.ok) {
    await grantSellerTotpSession(seller.id);
    // Fire-and-forget on purpose — notifySellerLogin() never throws
    // (see lib/actions/notify.ts), and a slow/failed email must never
    // delay or block the login itself.
    notifySellerLogin({ store_name: seller.store_name, email: seller.email });
  }
  return result;
}
