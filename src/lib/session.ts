import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "loja_admin_session";
const MAX_AGE = 60 * 60 * 24 * 14; // 14 days

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

/** Checks email/password against ADMIN_EMAIL / ADMIN_PASSWORD and, if they
 * match, sets a signed session cookie. This is intentionally simple —
 * single owner, single role, exactly what Epic A1 asks for. */
export async function login(identifier: string, password: string) {
  const okUser =
    identifier.trim().toLowerCase() === (process.env.ADMIN_EMAIL || "").toLowerCase();
  const okPass = password === process.env.ADMIN_PASSWORD;
  if (!okUser || !okPass) return false;

  const token = sign(`admin:${Date.now()}`);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
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
