import crypto from "node:crypto";

/* ---------------------------------------------------------------------------
 * One-tap order tracking links.
 *
 * The problem this solves: /o/<ref> asks for the phone number the order was
 * placed with before it shows anything. That is the right gate for someone
 * arriving cold, and exactly the wrong one for a buyer tapping a link the
 * store just sent to that very phone -- they have already proved who they
 * are by receiving the message.
 *
 * So the link carries a token. The token is an HMAC over the order reference,
 * the buyer's phone and an issue time, keyed with SESSION_SECRET. Verifying
 * it re-reads the phone from the order row server-side and recomputes the
 * MAC, which means:
 *
 *   * The phone number never appears in the URL. It would otherwise leak into
 *     WhatsApp previews, browser history, and any Referer header the page
 *     emits -- an earlier /o/<ref>?phone=... link did exactly that.
 *   * A token is bound to one order. It cannot be edited into a token for a
 *     different reference, and it is useless without the secret.
 *   * It grants precisely what knowing ref + phone already grants -- no more.
 *     That is the store's existing trust model (Decision 3: the phone number
 *     is the identity), reached by a different route.
 * ------------------------------------------------------------------------ */

/** 120 days. Long enough that a buyer scrolling back through WhatsApp months
 * later still gets their order, short enough that a link resting in someone's
 * message history forever does not stay live forever. */
const MAX_AGE_MS = 120 * 24 * 60 * 60 * 1000;

/** 22 base64url characters -- 132 bits of a SHA-256.
 *
 * base64url rather than hex for a specific reason: this link goes into an SMS,
 * where every character is billed. The same 132 bits cost 33 characters in hex
 * and 22 here, and its alphabet (A-Z a-z 0-9 - _) is entirely inside GSM-7, so
 * it never drags a message into the 70-character encoding. That is ~11
 * characters of message text bought back per notification, at no cost to how
 * hard the token is to forge. */
const MAC_LENGTH = 22;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

function mac(ref: string, phone: string, issuedAt: number): string {
  return crypto
    .createHmac("sha256", secret())
    .update(`track:${ref}:${phone}:${issuedAt}`)
    .digest("base64url")
    .slice(0, MAC_LENGTH);
}

/** `<issuedAt base36>.<mac>` — e.g. "m1abcd.9f3e…". */
export function issueTrackToken(ref: string, phone: string, now = Date.now()): string {
  return `${now.toString(36)}.${mac(ref, phone, now)}`;
}

export type TrackTokenVerdict =
  | { ok: true }
  | { ok: false; reason: "malformed" | "expired" | "mismatch" };

/** Checks a token against the reference and the phone read from the order.
 *
 * The caller supplies the phone from the database rather than the token
 * carrying it, which is the whole point -- see the note at the top. Callers
 * must therefore load the order before verifying, and must treat a false
 * verdict as "show the normal phone-entry gate", never as an error page: a
 * link that has simply aged out should still let the buyer type their number.
 */
export function verifyTrackToken(
  ref: string, phone: string, token: string, now = Date.now()
): TrackTokenVerdict {
  const dot = token.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };

  const issuedAt = parseInt(token.slice(0, dot), 36);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return { ok: false, reason: "malformed" };

  const supplied = token.slice(dot + 1);
  const expected = mac(ref, phone, issuedAt);

  // Constant-time, and length-checked first: timingSafeEqual throws on a
  // length mismatch rather than returning false, so a short token would be a
  // crash instead of a rejection.
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "mismatch" };
  }

  // Age is checked AFTER the MAC, so an attacker probing with forged tokens
  // learns nothing from which rejection they get.
  if (now - issuedAt > MAX_AGE_MS) return { ok: false, reason: "expired" };
  if (issuedAt - now > 60_000) return { ok: false, reason: "malformed" }; // clock skew, not the future

  return { ok: true };
}

/** Absolute, tappable link to one order. Absolute because it is going into a
 * chat message, where a relative path is just text. */
export function trackingUrl(ref: string, phone: string, origin: string): string {
  const base = (origin || "").replace(/\/+$/, "");
  return `${base}/o/${encodeURIComponent(ref)}?t=${issueTrackToken(ref, phone)}`;
}
