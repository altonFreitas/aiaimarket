"use server";
import { resolveLogin, grantSession, logout as doLogout, type AdminActor } from "@/lib/session";
import { rateLimit, callerKey } from "@/lib/rateLimit";
import { getOrCreateTotpSetup, confirmTotpSetup, verifyTotpCode, getTotpStatus, type TotpTarget } from "@/lib/totp";
import { redirect } from "next/navigation";

const ADMIN_TOTP_TARGET: TotpTarget = { table: "settings", idValue: 1 };

/** Second factor per person, not per shop.
 *
 * The owner keeps the secret that has always been on the settings row --
 * their authenticator app does not need re-enrolling. Staff each enrol
 * their own against their own row, so one person losing a phone never
 * takes anybody else's login with it. */
function totpTargetFor(actor: AdminActor): TotpTarget {
  return actor.kind === "owner"
    ? ADMIN_TOTP_TARGET
    : { table: "admin_users", idValue: actor.id as string };
}

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
  const actor = await resolveLogin(identifier, password);
  if (!actor) {
    return { ok: false as const };
  }
  const target = totpTargetFor(actor);
  const totpEnabled = await getTotpStatus(target);
  if (!totpEnabled) {
    // First time (or a retry mid-setup): reuses the pending secret if one
    // is already stored, so re-scanning is never required unless the
    // admin genuinely starts over.
    const setup = await getOrCreateTotpSetup(target, identifier);
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
  const actor = await resolveLogin(identifier, password);
  if (!actor) return { ok: false, reason: "credentials" as const };
  const confirmed = await confirmTotpSetup(totpTargetFor(actor), code, identifier);
  if (!confirmed) return { ok: false, reason: "code" as const };
  await grantSession(actor);
  await noteLogin(actor);
  return { ok: true };
}

/** Step 2b — ongoing logins: re-checks the password, verifies the code
 * against the already-enrolled secret, and grants the session. */
export async function finishTotpLoginAction(identifier: string, password: string, code: string) {
  const actor = await resolveLogin(identifier, password);
  if (!actor) return { ok: false, locked: false, reason: "credentials" as const };
  const result = await verifyTotpCode(totpTargetFor(actor), code, identifier);
  if (!result.ok) return { ok: false, locked: result.locked, reason: "code" as const };
  await grantSession(actor);
  await noteLogin(actor);
  return { ok: true };
}

/** Last seen, and a line in the record. Never blocks the login: someone
 * who has just proved both factors is getting in whether or not the note
 * could be written. */
async function noteLogin(actor: AdminActor) {
  try {
    if (actor.kind === "staff" && actor.id) {
      const { supabaseAdmin } = await import("@/lib/supabase/admin");
      await supabaseAdmin().from("admin_users")
        .update({ last_login_at: new Date().toISOString() }).eq("id", actor.id);
    }
    const { audit } = await import("@/lib/audit");
    await audit(actor, { action: "auth.login", summary: `${actor.label} signed in` });
  } catch { /* the session is already granted; this is only the note */ }
}

export async function logoutAction() {
  await doLogout();
  redirect("/admin/login");
}
