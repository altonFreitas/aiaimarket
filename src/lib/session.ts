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
export function checkCredentials(identifier: string, password: string): boolean {
  const okUser =
    identifier.trim().toLowerCase() === (process.env.ADMIN_EMAIL || "").toLowerCase();
  const okPass = password === process.env.ADMIN_PASSWORD;
  return okUser && okPass;
}

/** Grants the actual session. Only call this after both the password and
 * (when 2FA is enabled) the TOTP code have already been verified. */
export async function grantSession() {
  const token = sign(`admin:${Date.now()}`);
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

export async function isLoggedIn() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return false;
  return verify(token) !== null;
}

export { COOKIE as SESSION_COOKIE };
