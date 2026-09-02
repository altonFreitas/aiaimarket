import crypto from "node:crypto";

/* Password hashing for staff accounts.
 *
 * scrypt, from Node's own crypto. No dependency to keep patched, and a
 * real password KDF rather than a plain hash -- SHA-256 over a password is
 * something a graphics card walks through in an afternoon, which is the
 * whole reason KDFs exist.
 *
 * Stored as "scrypt$N$r$p$salt$hash", every parameter in the string. The
 * cost of scrypt is meant to rise as hardware does, and a stored hash that
 * does not carry the cost it was made with cannot be raised later without
 * locking everybody out. */

const ALG = "scrypt";
// N=2^15 with r=8 is about 32 MB and a few tens of milliseconds -- slow
// enough to matter to someone guessing, fast enough not to be noticed by
// someone logging in.
const N = 32768, R = 8, P = 1, KEYLEN = 32;
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer, n = N, r = R, p = P): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize("NFKC"), salt, KEYLEN,
      // scrypt needs roughly 128 * N * r bytes and Node refuses past its
      // default limit, so the limit is raised to match the parameters.
      { N: n, r, p, maxmem: 256 * n * r },
      (err, key) => (err ? reject(err) : resolve(key as Buffer)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  return [ALG, N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

/** Constant-time, and false rather than throwing on anything malformed: a
 * corrupted or hand-edited hash must fail the login, not crash the page
 * that checks it. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [alg, n, r, p, saltB64, hashB64] = String(stored).split("$");
    if (alg !== ALG) return false;

    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    if (!salt.length || !expected.length) return false;

    // Parameters come from the stored string, not from the constants above,
    // so raising the cost later still verifies every password set before it.
    const key = await derive(password, salt, Number(n), Number(r), Number(p));
    if (key.length !== expected.length) return false;
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// Re-exported so a server-side caller needs only one import. The rules
// themselves live in passwordRules.ts, which pulls in no crypto and can
// therefore be read by a client component.
export { MIN_PASSWORD_LEN, passwordProblem } from "./passwordRules";
