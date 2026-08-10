import "server-only";
import { TOTP, Secret } from "otpauth";
import QRCode from "qrcode";
import { supabaseAdmin } from "@/lib/supabase/admin";

const LOCKOUT_AFTER = 5;          // failed codes before locking
const LOCKOUT_MINUTES = 5;

function makeTotp(secretBase32: string, label: string) {
  return new TOTP({
    issuer: "Loja AIAI",
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
}

/** Setup step, made idempotent: if a pending (not-yet-confirmed) secret
 * already exists, reuse it and regenerate the same QR from it, instead of
 * minting a new random secret on every call. Without this, any retry
 * mid-setup — a page refresh, a dev-server hot-reload, clicking back and
 * trying again — would orphan whatever the admin already scanned into
 * their authenticator app, and no code they type would ever validate. */
export async function getOrCreateTotpSetup(label: string) {
  const sb = supabaseAdmin();
  const { data } = await sb.from("settings").select("totp_secret, totp_enabled").eq("id", 1).single();
  if (data?.totp_enabled) return null; // already fully enrolled — nothing to set up

  let secretBase32 = data?.totp_secret as string | null;
  if (!secretBase32) {
    secretBase32 = new Secret({ size: 20 }).base32;
    await sb.from("settings").update({ totp_secret: secretBase32 }).eq("id", 1);
  }

  const totp = makeTotp(secretBase32, label);
  const qrDataUrl = await QRCode.toDataURL(totp.toString(), { width: 240, margin: 1 });
  return { secretBase32, qrDataUrl };
}

/** First-time setup: verify the code against the secret already persisted
 * by getOrCreateTotpSetup (never a secret passed in from the client), and
 * only then flip totp_enabled on. */
export async function confirmTotpSetup(code: string, label: string) {
  const sb = supabaseAdmin();
  const { data } = await sb.from("settings").select("totp_secret").eq("id", 1).single();
  if (!data?.totp_secret) return false;
  const totp = makeTotp(data.totp_secret, label);
  const delta = totp.validate({ token: code.trim(), window: 1 });
  if (delta === null) return false;
  await sb.from("settings").update({
    totp_enabled: true, totp_failed_attempts: 0, totp_locked_until: null,
  }).eq("id", 1);
  return true;
}

/** Ongoing logins: verify a code against the already-stored secret, with
 * a simple failed-attempt lockout since this endpoint is public-facing. */
export async function verifyTotpCode(code: string, label: string) {
  const sb = supabaseAdmin();
  const { data: settings } = await sb
    .from("settings")
    .select("totp_secret, totp_failed_attempts, totp_locked_until")
    .eq("id", 1)
    .single();
  if (!settings?.totp_secret) return { ok: false, locked: false };

  if (settings.totp_locked_until && new Date(settings.totp_locked_until) > new Date()) {
    return { ok: false, locked: true };
  }

  const totp = makeTotp(settings.totp_secret, label);
  const delta = totp.validate({ token: code.trim(), window: 1 });

  if (delta === null) {
    const attempts = (settings.totp_failed_attempts || 0) + 1;
    const patch: Record<string, unknown> = { totp_failed_attempts: attempts };
    if (attempts >= LOCKOUT_AFTER) {
      patch.totp_locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
      patch.totp_failed_attempts = 0;
    }
    await sb.from("settings").update(patch).eq("id", 1);
    return { ok: false, locked: attempts >= LOCKOUT_AFTER };
  }

  await sb.from("settings").update({ totp_failed_attempts: 0, totp_locked_until: null }).eq("id", 1);
  return { ok: true, locked: false };
}

export async function getTotpStatus() {
  const sb = supabaseAdmin();
  const { data } = await sb.from("settings").select("totp_enabled").eq("id", 1).single();
  return !!data?.totp_enabled;
}
