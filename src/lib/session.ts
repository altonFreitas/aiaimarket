import "server-only";
import crypto from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import {
  normalizeRole, normalizeSections, type AdminRole, type SectionKey,
} from "@/lib/adminSections";

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

  // THE OWNER'S EMAIL IS THE OWNER'S, AND NOBODY ELSE'S.
  //
  // Without this, failing the owner check above fell through to
  // admin_users and matched a staff row with the same address -- so an
  // owner who had created a staff account under their own email, and
  // typed that account's password, was quietly signed in as it. If the
  // account was read-only, everything then behaved exactly as though the
  // owner had lost their access: saves refused, Admin users a dead end.
  // The password was right, the person was right, and the identity was
  // wrong.
  //
  // One address, one identity. Creating such an account is refused now
  // too (see lib/actions/adminUsers.ts), but a shop that already has one
  // must not keep signing its owner in as it.
  const ownerEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (ownerEmail && email === ownerEmail) return null;

  try {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const { verifyPassword } = await import("@/lib/password");
    const sb = supabaseAdmin();
    const data = await readAdminUser(
      sb, (cols) => sb.from("admin_users").select(cols).ilike("email", email).maybeSingle()
    );
    if (!data || !data.active) return null;
    if (!(await verifyPassword(password, data.password_hash as string))) return null;
    return {
      kind: "staff", id: data.id as string, label: (data.name as string) || email,
      role: normalizeRole(data.role), sections: normalizeSections(data.sections),
    };
  } catch {
    // No admin_users table yet, or it is unreachable. The owner path above
    // has already had its chance, so there is nothing left to try.
    return null;
  }
}

/* The columns an account needs to sign in, and the two that say what it
 * may then do. They are split because the second pair arrived in a later
 * migration (supabase/admin-roles.sql) and Postgres fails the WHOLE query
 * when a select names a column that does not exist.
 *
 * So a shop that had staff accounts and had not yet run that file would
 * have found every one of them unable to log in, and every open staff
 * session dead -- not because of anything to do with permissions, but
 * because the query asked for a column. Asking again without it lets them
 * in as a reader holding nothing, which is the safe reading of "this
 * database cannot tell me what they may do". */
const AUTH_COLUMNS = "id, name, password_hash, active";
const ROLE_COLUMNS = "role, sections";

type AdminUserRead = Record<string, unknown> | null;

async function readAdminUser(
  _sb: unknown,
  run: (columns: string) => PromiseLike<{ data: AdminUserRead; error: unknown }>
): Promise<AdminUserRead> {
  const full = await run(`${AUTH_COLUMNS}, ${ROLE_COLUMNS}`);
  if (!full.error) return full.data;
  const base = await run(AUTH_COLUMNS);
  if (base.error) return null;
  return base.data;
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

/** WHO is signed in -- the part the cookie carries.
 *
 * Identity only. Permissions are deliberately not in here: see AdminActor
 * below for why. */
export interface ActorIdentity {
  kind: "owner" | "staff";
  /** admin_users.id for staff, null for the owner. */
  id: string | null;
  /** Their name, carried in the session so recording an action never needs
   * a second query -- and copied onto each audit entry, so the record
   * survives the account being renamed or removed. */
  label: string;
}

/** Who is signed in AND what they may do.
 *
 * The permissions are NOT in the cookie. They are read from admin_users on
 * each request, which costs one indexed lookup by primary key, deduped per
 * request by React's cache().
 *
 * Baking them into the signed token would be cheaper and is the obvious
 * design -- it is also wrong here. A token is a statement about the past:
 * it says what was true when it was issued. Sessions last ten minutes, so
 * "Disable" on the Admin users screen would mean "disabled within ten
 * minutes", and the moment you most want to disable an account is the
 * moment those ten minutes matter most. Reading the row makes revoking
 * access, changing a role and unticking a section all take effect on the
 * person's very next click.
 *
 * The identity stays in the token because it is genuinely a fact about the
 * past -- it is who passed the password and the code -- and because the
 * audit trail must be able to name them even if the row later changes. */
export interface AdminActor extends ActorIdentity {
  /** What they may do: "admin" writes, "reader" only looks. */
  role: AdminRole;
  /** Which parts of the admin they may open. Empty for the owner, who is
   * not filtered by it at all -- see canSee(). */
  sections: SectionKey[];
}

/** The owner as the cookie carries them. */
export const OWNER_IDENTITY: ActorIdentity = { kind: "owner", id: null, label: "Owner" };

/** The owner has no row and no checkboxes: theirs is the login the shop is
 * reachable through if everything on the Admin users screen goes wrong, so
 * it is never filtered. */
export const OWNER: AdminActor = { ...OWNER_IDENTITY, role: "admin", sections: [] };

/* The session payload, encoded and decoded as pure functions.
 *
 * Separated from the cookie so the part that actually decides whether a
 * token is accepted can be tested without a request. This is the code that
 * stands between a stranger and the admin; it should not be reachable only
 * through next/headers. */

export function encodeActor(actor: ActorIdentity, issuedAt: number): string {
  // JSON rather than colon-separated fields: a staff member called
  // "Ana: Sales" would otherwise split the token in half.
  return "v2." + Buffer.from(JSON.stringify({
    k: actor.kind, i: actor.id, n: actor.label, t: issuedAt,
  })).toString("base64url");
}

export function decodeActor(
  value: string, now: number, maxAgeMs: number
): ActorIdentity | null {
  // Sessions issued before named accounts existed read "admin:<ts>". They
  // last ten minutes, so this matters for one deploy -- but a confusing
  // ten minutes is still worth a few lines.
  if (value.startsWith("admin:")) {
    const issuedAt = Number(value.split(":")[1]);
    if (!Number.isFinite(issuedAt) || now - issuedAt > maxAgeMs) return null;
    return OWNER_IDENTITY;
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
export async function grantSession(actor: ActorIdentity = OWNER_IDENTITY) {
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

/** Reads role and sections for a staff account, live.
 *
 * Fails closed on every uncertain answer -- no row, inactive, a failed
 * query, no table at all. None of those can happen to a legitimately
 * signed-in staff member during normal operation: they had a row a moment
 * ago, or they could not have logged in. Treating them as "no access"
 * costs a re-login in the rare case and refuses access in the bad one.
 *
 * The owner never reaches this code. Their login does not depend on the
 * database, and it stays that way. */
async function staffPermissions(who: ActorIdentity): Promise<AdminActor | null> {
  if (!who.id) return null;
  try {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const sb = supabaseAdmin();
    const data = await readAdminUser(
      sb, (cols) => sb.from("admin_users").select(cols).eq("id", who.id!).maybeSingle()
    );
    if (!data || !data.active) return null;
    return {
      ...who,
      role: normalizeRole(data.role),
      sections: normalizeSections(data.sections),
    };
  } catch {
    return null;
  }
}

/** The signed-in admin, or null. The single place the cookie is read.
 *
 * The cookie's maxAge is enforced by the BROWSER, which an attacker
 * replaying a captured token simply isn't. The signed payload carries its
 * own issue time -- checked here, server-side, or the token stays valid
 * forever.
 *
 * cache() so the permission lookup happens once per request no matter how
 * many guards, pages and actions ask who is signed in. */
export const currentActor = cache(async function currentActor(): Promise<AdminActor | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  const value = verify(token);
  if (!value) return null;

  const who = decodeActor(value, Date.now(), MAX_AGE * 1000);
  if (!who) return null;
  if (who.kind === "owner") return OWNER;

  return staffPermissions(who);
});

export async function isLoggedIn() {
  return (await currentActor()) !== null;
}

export { COOKIE as SESSION_COOKIE };
