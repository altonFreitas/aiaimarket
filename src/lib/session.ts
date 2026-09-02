import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "loja_admin_session";
// 10 minutes -- the whole session, not just a "remember me" window. The
// admin's login already includes TOTP as one step, so this session
// expiring means the next visit re-asks for password + code together,
// same as any other fresh login.
const MAX_AGE = 60 * 10;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

function sign(value: string) {
  const h = crypto.createHmac("sha256", secret()).update(value).digest("hex");
  return `${value}.${h}`;
}
function verify(token: string): string | null {
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const value = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = crypto.createHmac("sha256", secret()).update(value).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

/** Pure credential check — no side effects, no cookie. Used both before
 * showing the TOTP step and again when confirming it, so a stolen
 * half-completed flow can't skip straight to the second factor. */
const MIN_ADMIN_PASSWORD_LEN = 12;

export function checkCredentials(identifier: string, password: string): boolean {
  const expectedEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const expectedPassword = process.env.ADMIN_PASSWORD || "";

  // Fail CLOSED on missing configuration. Without this, an unconfigured
  // deploy authenticates an empty email against an empty password —
  // "" === "" is true, and crypto.timingSafeEqual() on two zero-length
  // buffers also returns true — handing /admin to the first visitor who
  // submits a blank form.
  if (!expectedEmail || !expectedPassword) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD must both be set. Refusing to authenticate."
    );
  }
  if (expectedPassword.length < MIN_ADMIN_PASSWORD_LEN) {
    throw new Error(
      `ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LEN} characters. Refusing to authenticate.`
    );
  }

  const okUser = identifier.trim().toLowerCase() === expectedEmail;
  const okPass = timingSafeStringEqual(password, expectedPassword);
  return okUser && okPass;
}

/** Resolves a login to the person behind it: the environment owner, a
 * staff account, or nobody.
 *
 * The owner is checked FIRST and by the original code path, untouched. A
 * shop depends on this login, and staff accounts must not be able to break
 * the way in that already works -- if admin_users does not exist, or the
 * query fails, or the table is empty, the owner still gets in.
 *
 * Returns null for a wrong password and for a deactivated account alike:
 * which of the two it was is not something a login form should say. */
export async function resolveLogin(
  identifier: string, password: string
): Promise<AdminActor | null> {
  if (checkCredentials(identifier, password)) return OWNER;

  const email = identifier.trim().toLowerCase();
  if (!email) return null;

  try {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const { verifyPassword } = await import("@/lib/password");
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("admin_users")
      .select("id, name, password_hash, active")
      .ilike("email", email)
      .maybeSingle();
    if (error || !data || !data.active) return null;
    if (!(await verifyPassword(password, data.password_hash as string))) return null;
    return { kind: "staff", id: data.id as string, label: (data.name as string) || email };
  } catch {
    // No admin_users table yet, or it is unreachable. The owner path above
    // has already had its chance, so there is nothing left to try.
    return null;
  }
}

/** Constant-time string comparison so a wrong admin password can't be
 * brute-forced by measuring how long the comparison took to fail. */
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still run a comparison of equal length so failure timing doesn't
    // leak the real password's length either.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Who is signed in. The owner is the environment credentials and has no
 * database row; staff are rows in admin_users. */
export interface AdminActor {
  kind: "owner" | "staff";
  /** admin_users.id for staff, null for the owner. */
  id: string | null;
  /** Their name, carried in the session so recording an action never needs
   * a second query -- and copied onto each audit entry, so the record
   * survives the account being renamed or removed. */
  label: string;
}

export const OWNER: AdminActor = { kind: "owner", id: null, label: "Owner" };

/* The session payload, encoded and decoded as pure functions.
 *
 * Separated from the cookie so the part that actually decides whether a
 * token is accepted can be tested without a request. This is the code that
 * stands between a stranger and the admin; it should not be reachable only
 * through next/headers. */

export function encodeActor(actor: AdminActor, issuedAt: number): string {
  // JSON rather than colon-separated fields: a staff member called
  // "Ana: Sales" would otherwise split the token in half.
  return "v2." + Buffer.from(JSON.stringify({
    k: actor.kind, i: actor.id, n: actor.label, t: issuedAt,
  })).toString("base64url");
}

export function decodeActor(
  value: string, now: number, maxAgeMs: number
): AdminActor | null {
  // Sessions issued before named accounts existed read "admin:<ts>". They
  // last ten minutes, so this matters for one deploy -- but a confusing
  // ten minutes is still worth a few lines.
  if (value.startsWith("admin:")) {
    const issuedAt = Number(value.split(":")[1]);
    if (!Number.isFinite(issuedAt) || now - issuedAt > maxAgeMs) return null;
    return OWNER;
  }

  if (!value.startsWith("v2.")) return null;
  try {
    const raw = JSON.parse(Buffer.from(value.slice(3), "base64url").toString("utf8"));
    const issuedAt = Number(raw?.t);
    if (!Number.isFinite(issuedAt) || now - issuedAt > maxAgeMs) return null;
    if (raw?.k !== "owner" && raw?.k !== "staff") return null;
    // A staff session with no id could not be attributed to anybody, which
    // is the one thing this whole change exists to prevent.
    const id = typeof raw.i === "string" && raw.i ? raw.i : null;
    if (raw.k === "staff" && !id) return null;
    return {
      kind: raw.k,
      id: raw.k === "owner" ? null : id,
      label: typeof raw.n === "string" && raw.n ? raw.n : "Admin",
    };
  } catch {
    return null;
  }
}

/** Grants the actual session. Only call this after both the password and
 * (when 2FA is enabled) the TOTP code have already been verified. */
export async function grantSession(actor: AdminActor = OWNER) {
  const token = sign(encodeActor(actor, Date.now()));
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
}

/** Checks email/password against ADMIN_EMAIL / ADMIN_PASSWORD and, if they
 * match, sets a signed session cookie. Kept for compatibility with a plain
 * one-step login when 2FA isn't in play. */
export async function login(identifier: string, password: string) {
  if (!checkCredentials(identifier, password)) return false;
  await grantSession();
  return true;
}

export async function logout() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** The signed-in admin, or null. The single place the cookie is read.
 *
 * The cookie's maxAge is enforced by the BROWSER, which an attacker
 * replaying a captured token simply isn't. The signed payload carries its
 * own issue time -- checked here, server-side, or the token stays valid
 * forever. */
export async function currentActor(): Promise<AdminActor | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  const value = verify(token);
  if (!value) return null;

  return decodeActor(value, Date.now(), MAX_AGE * 1000);
}

export async function isLoggedIn() {
  return (await currentActor()) !== null;
}

export { COOKIE as SESSION_COOKIE };
