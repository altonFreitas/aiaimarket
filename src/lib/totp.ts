import "server-only";
import { TOTP, Secret } from "otpauth";
import QRCode from "qrcode";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeTolerating } from "@/lib/missingColumn";

const LOCKOUT_AFTER = 5;          // failed codes before locking
const LOCKOUT_MINUTES = 5;
const PERIOD_SECONDS = 30;        // must match makeTotp below

/** Which row's totp_* columns to read/write — the admin's single
 * settings row (id=1), or one seller's own row in `sellers`. Both
 * tables have the identical four totp_* columns (see schema.sql), so
 * everything below is written once and shared by both the admin login
 * (lib/actions/auth.ts) and seller login/settings
 * (lib/actions/seller-totp.ts) instead of being duplicated per role. */
export interface TotpTarget {
  /** admin_users carries the same four totp_* columns as the other two,
   * which is what lets every path through this file stay generic. */
  table: "settings" | "sellers" | "admin_users";
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

/** WHICH TIME STEP A CODE BELONGS TO.
 *
 * otpauth's validate() returns a DELTA -- how many steps away from now the
 * code was -- so the absolute step is the current one plus that. Exported
 * for the test, which is the only way to pin this arithmetic without
 * waiting thirty seconds.
 *
 * The window is deliberately +/-1 step, which makes any code good for
 * about ninety seconds. That is the tolerance a phone with a drifting
 * clock needs, and it is also exactly the window a replay lives in. */
export function counterFor(delta: number, nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / PERIOD_SECONDS) + delta;
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
  // The enrolment code is spent as well. Without this the six digits just
  // typed into the setup form are still good for the first login, which
  // is the one moment they are most likely to be on somebody's screen.
  await writeTolerating({ totp_last_counter: counterFor(delta) }, (extra) =>
    sb.from(target.table).update({
      totp_enabled: true, totp_failed_attempts: 0, totp_locked_until: null, ...extra,
    }).eq("id", target.idValue));
  return true;
}

/** Ongoing logins: verify a code against the already-stored secret, with
 * a simple failed-attempt lockout since this endpoint is public-facing,
 * and a one-use rule so a correct code cannot be spent twice. */
export async function verifyTotpCode(target: TotpTarget, code: string, label: string) {
  const sb = supabaseAdmin();
  // totp_last_counter is read through a second, narrower select rather
  // than added to this one: a database that has not run
  // supabase/totp-replay.sql has no such column, and naming an unknown
  // column fails the WHOLE query -- which would lock every 2FA login out
  // of the shop rather than degrade.
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

  /* THE CODE IS CORRECT. Has it already been used?
   *
   * Treated as a failed attempt, not as a separate outcome: whoever is
   * submitting a code that was already spent is either replaying it or
   * has double-submitted a form, and counting it toward the lockout is
   * the right answer to both. The caller sees the same "wrong code" it
   * sees for anything else, which is what stops this being an oracle
   * telling an attacker their captured code was genuine.
   *
   * On a database without supabase/totp-replay.sql, the read comes back
   * undefined and the write is dropped -- the login behaves exactly as it
   * did before, rather than refusing everyone. */
  const counter = counterFor(delta);
  const lastCounter = await readLastCounter(target);
  if (lastCounter != null && counter <= lastCounter) {
    const attempts = (row.totp_failed_attempts || 0) + 1;
    const patch: Record<string, unknown> = { totp_failed_attempts: attempts };
    if (attempts >= LOCKOUT_AFTER) {
      patch.totp_locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
      patch.totp_failed_attempts = 0;
    }
    await sb.from(target.table).update(patch).eq("id", target.idValue);
    return { ok: false, locked: attempts >= LOCKOUT_AFTER };
  }

  const cleared = { totp_failed_attempts: 0, totp_locked_until: null };
  const written = await writeTolerating({ totp_last_counter: counter }, (extra) =>
    sb.from(target.table).update({ ...cleared, ...extra }).eq("id", target.idValue));
  if (written.error) {
    // The counter could not be recorded for a reason that is not a
    // missing column. Sign them in -- the code was genuine and refusing a
    // correct code because a bookkeeping write failed would turn a
    // database blip into a lockout -- but say so, because until it is
    // fixed this code stays replayable.
    console.error("[totp] could not record the used counter: %s",
      written.error instanceof Error ? written.error.message : String(written.error));
  }
  return { ok: true, locked: false };
}

/** The last accepted time step, or null when this database has no such
 * column yet (supabase/totp-replay.sql not run) -- which reads as "no
 * code has been spent", the behaviour this file had before. */
async function readLastCounter(target: TotpTarget): Promise<number | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from(target.table).select("totp_last_counter").eq("id", target.idValue).single();
  if (error || !data) return null;
  const value = (data as { totp_last_counter?: number | null }).totp_last_counter;
  return typeof value === "number" ? value : null;
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
  // The counter goes with the secret. It counts steps against a secret
  // that is about to be thrown away, so leaving it behind would mean a
  // fresh enrolment inherits a stranger's high-water mark.
  await writeTolerating({ totp_last_counter: null }, (extra) =>
    sb.from(target.table).update({
      totp_enabled: false, totp_secret: null,
      totp_failed_attempts: 0, totp_locked_until: null, ...extra,
    }).eq("id", target.idValue));
}
