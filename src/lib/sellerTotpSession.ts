import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";

/** Supabase Auth's own session is created the moment a password check
 * succeeds — there's no built-in way to pause it mid-login for a second
 * factor the way the admin's hand-rolled session in lib/session.ts can.
 * So 2FA for a seller is enforced with a second, independent cookie:
 * password can be right and the Supabase session valid, but until this
 * cookie also says the TOTP code was verified, requireSeller() (see
 * lib/actions/guard.ts) treats the account as not fully authenticated. */
const COOKIE = "loja_seller_totp_ok";
const MAX_AGE = 60 * 60 * 24 * 14; // 14 days, matches the admin session

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

export async function grantSellerTotpSession(sellerId: string) {
  const token = sign(`seller-totp:${sellerId}`);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
}

/** Tied to a specific sellerId, not just "any valid cookie" — so this
 * can never be reused across two different seller accounts, e.g. if the
 * cookie somehow survived a logout/login as someone else on the same
 * browser. */
export async function hasSellerTotpSession(sellerId: string): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return false;
  return verify(token) === `seller-totp:${sellerId}`;
}

export async function clearSellerTotpSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}
