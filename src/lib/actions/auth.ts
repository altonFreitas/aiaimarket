"use server";
import { checkCredentials, grantSession, logout as doLogout } from "@/lib/session";
import { rateLimit, callerKey } from "@/lib/rateLimit";
import { getOrCreateTotpSetup, confirmTotpSetup, verifyTotpCode, getTotpStatus, type TotpTarget } from "@/lib/totp";
import { redirect } from "next/navigation";

const ADMIN_TOTP_TARGET: TotpTarget = { table: "settings", idValue: 1 };

/** Step 1: password check only. Never grants a session — just tells the
 * client which second-factor screen to show next. */
export async function checkPasswordAction(identifier: string, password: string) {
  // The TOTP step has had a lockout since day one; the password step had
  // none, so ADMIN_PASSWORD could be guessed at whatever rate the network
  // allowed. 10 attempts / 5 minutes per IP.
  const limit = rateLimit(await callerKey("admin-login"), 10, 300);
  if (!limit.allowed) {
    throw new Error(`Too many attempts. Try again in ${limit.retryAfterSeconds}s.`);
  }
  if (!checkCredentials(identifier, password)) {
    return { ok: false as const };
  }
  const totpEnabled = await getTotpStatus(ADMIN_TOTP_TARGET);
  if (!totpEnabled) {
    // First time (or a retry mid-setup): reuses the pending secret if one
    // is already stored, so re-scanning is never required unless the
    // admin genuinely starts over.
    const setup = await getOrCreateTotpSetup(ADMIN_TOTP_TARGET, identifier);
    if (setup) return { ok: true as const, totpEnabled: false as const, ...setup };
    // Enabled by another tab/session in the moment between the two checks
    // above — fall through to the normal verify screen instead of a
    // half-empty setup response.
  }
  return { ok: true as const, totpEnabled: true as const };
}

/** Step 2a — first-time setup: re-checks the password, verifies the code
 * against the secret already persisted server-side, and only then enables
 * 2FA and grants the session. The client never needs to send the secret
 * back — the server is the only source of truth for it. */
export async function finishTotpSetupAction(identifier: string, password: string, code: string) {
  if (!checkCredentials(identifier, password)) return { ok: false, reason: "credentials" as const };
  const confirmed = await confirmTotpSetup(ADMIN_TOTP_TARGET, code, identifier);
  if (!confirmed) return { ok: false, reason: "code" as const };
  await grantSession();
  return { ok: true };
}

/** Step 2b — ongoing logins: re-checks the password, verifies the code
 * against the already-enrolled secret, and grants the session. */
export async function finishTotpLoginAction(identifier: string, password: string, code: string) {
  if (!checkCredentials(identifier, password)) return { ok: false, locked: false, reason: "credentials" as const };
  const result = await verifyTotpCode(ADMIN_TOTP_TARGET, code, identifier);
  if (!result.ok) return { ok: false, locked: result.locked, reason: "code" as const };
  await grantSession();
  return { ok: true };
}

export async function logoutAction() {
  await doLogout();
  redirect("/admin/login");
}
