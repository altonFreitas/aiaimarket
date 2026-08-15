import "server-only";
import { TOTP, Secret } from "otpauth";
import QRCode from "qrcode";
import { supabaseAdmin } from "@/lib/supabase/admin";

const LOCKOUT_AFTER = 5;          // failed codes before locking
const LOCKOUT_MINUTES = 5;

/** Which row's totp_* columns to read/write — the admin's single
 * settings row (id=1), or one seller's own row in `sellers`. Both
 * tables have the identical four totp_* columns (see schema.sql), so
 * everything below is written once and shared by both the admin login
 * (lib/actions/auth.ts) and seller login/settings
 * (lib/actions/seller-totp.ts) instead of being duplicated per role. */
export interface TotpTarget {
  table: "settings" | "sellers";
  idValue: string | number;
}

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
 * trying again — would orphan whatever was already scanned into an
 * authenticator app, and no code typed would ever validate. */
export async function getOrCreateTotpSetup(target: TotpTarget, label: string) {
  const sb = supabaseAdmin();
  const { data } = await sb.from(target.table).select("totp_secret, totp_enabled").eq("id", target.idValue).single();
  if (data?.totp_enabled) return null; // already fully enrolled — nothing to set up

  let secretBase32 = data?.totp_secret as string | null;
  if (!secretBase32) {
    secretBase32 = new Secret({ size: 20 }).base32;
    await sb.from(target.table).update({ totp_secret: secretBase32 }).eq("id", target.idValue);
  }

  const totp = makeTotp(secretBase32, label);
  const qrDataUrl = await QRCode.toDataURL(totp.toString(), { width: 240, margin: 1 });
  return { secretBase32, qrDataUrl };
}

/** First-time setup: verify the code against the secret already persisted
 * by getOrCreateTotpSetup (never a secret passed in from the client), and
 * only then flip totp_enabled on. */
export async function confirmTotpSetup(target: TotpTarget, code: string, label: string) {
  const sb = supabaseAdmin();
  const { data } = await sb.from(target.table).select("totp_secret").eq("id", target.idValue).single();
  if (!data?.totp_secret) return false;
  const totp = makeTotp(data.totp_secret, label);
  const delta = totp.validate({ token: code.trim(), window: 1 });
  if (delta === null) return false;
  await sb.from(target.table).update({
    totp_enabled: true, totp_failed_attempts: 0, totp_locked_until: null,
  }).eq("id", target.idValue);
  return true;
}

/** Ongoing logins: verify a code against the already-stored secret, with
 * a simple failed-attempt lockout since this endpoint is public-facing. */
export async function verifyTotpCode(target: TotpTarget, code: string, label: string) {
  const sb = supabaseAdmin();
  const { data: row } = await sb
    .from(target.table)
    .select("totp_secret, totp_failed_attempts, totp_locked_until")
    .eq("id", target.idValue)
    .single();
  if (!row?.totp_secret) return { ok: false, locked: false };

  if (row.totp_locked_until && new Date(row.totp_locked_until) > new Date()) {
    return { ok: false, locked: true };
  }

  const totp = makeTotp(row.totp_secret, label);
  const delta = totp.validate({ token: code.trim(), window: 1 });

  if (delta === null) {
    const attempts = (row.totp_failed_attempts || 0) + 1;
    const patch: Record<string, unknown> = { totp_failed_attempts: attempts };
    if (attempts >= LOCKOUT_AFTER) {
      patch.totp_locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
      patch.totp_failed_attempts = 0;
    }
    await sb.from(target.table).update(patch).eq("id", target.idValue);
    return { ok: false, locked: attempts >= LOCKOUT_AFTER };
  }

  await sb.from(target.table).update({ totp_failed_attempts: 0, totp_locked_until: null }).eq("id", target.idValue);
  return { ok: true, locked: false };
}

export async function getTotpStatus(target: TotpTarget) {
  const sb = supabaseAdmin();
  const { data } = await sb.from(target.table).select("totp_enabled").eq("id", target.idValue).single();
  return !!data?.totp_enabled;
}

/** Turns 2FA back off and wipes the secret — only used by the seller
 * settings opt-out (the admin has no path to disable it once enrolled,
 * by design; a seller choosing their own security level is different). */
export async function disableTotp(target: TotpTarget) {
  const sb = supabaseAdmin();
  await sb.from(target.table).update({
    totp_enabled: false, totp_secret: null, totp_failed_attempts: 0, totp_locked_until: null,
  }).eq("id", target.idValue);
}
