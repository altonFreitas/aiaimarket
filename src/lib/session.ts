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

  const value = verify(token);
  if (!value) return false;

  // The cookie's maxAge is enforced by the BROWSER, which an attacker
  // replaying a captured token simply isn't. The signed payload carries
  // its own issue time — check it here, server-side, or the token stays
  // valid forever.
  const issuedAt = Number(value.split(":")[1]);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > MAX_AGE * 1000) return false;

  return true;
}

export { COOKIE as SESSION_COOKIE };
