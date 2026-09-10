import "server-only";
import { createHash } from "node:crypto";
import { rateLimit, callerKey } from "@/lib/rateLimit";

/* THE THROTTLE IN FRONT OF EVERY PASSWORD FORM.
 *
 * Supabase Auth has its own limits, but they are per-project and tuned for
 * a signup flood, not for somebody working through a wordlist against one
 * known address. Until this existed, /account accepted password guesses
 * for a seller's store at whatever rate the network allowed -- and a seller
 * account is a login to somebody else's shop, their orders and their
 * payouts.
 *
 * TWO KEYS, because one is always the wrong one:
 *
 *   - Per IP, so one machine cannot work through a wordlist. On its own it
 *     misses a botnet, which is one guess per address.
 *   - Per account, so a distributed attack on one seller is still counted
 *     as one attack. On its own it is a way to lock a shop out of its own
 *     store: guess wrong ten times at somebody's email and they cannot log
 *     in either.
 *
 * Which is why the per-account window is the more generous of the two and
 * the IP window is the tight one: the IP key is what actually stops the
 * attack, and the account key is the backstop for the case the IP key
 * cannot see. Neither is strict enough to be a denial-of-service tool.
 *
 * The email is HASHED into the key. rate_limits rows are readable by
 * anything holding the service role, and a table listing the addresses
 * people have recently tried to log in as is a mailing list nobody
 * consented to. The hash still counts the same address every time.
 */

/** Guesses allowed from one IP before it has to wait. */
export const LOGIN_IP_LIMIT = 10;
export const LOGIN_IP_WINDOW = 300; // 5 minutes

/** Guesses allowed against one address, from anywhere. Deliberately looser
 * and over a longer window -- see above. */
export const LOGIN_ACCOUNT_LIMIT = 20;
export const LOGIN_ACCOUNT_WINDOW = 900; // 15 minutes

export function loginAccountKey(email: string): string {
  const normalized = email.trim().toLowerCase();
  return `login-acct:${createHash("sha256").update(normalized).digest("hex").slice(0, 32)}`;
}

/** The message every throttled login gives back.
 *
 * Identical whether the address exists or not, and identical to nothing
 * else this form says -- a throttle that only fires on real accounts is an
 * account-existence oracle wearing a different hat. */
export const LOGIN_THROTTLED = "Too many attempts. Please wait a few minutes and try again.";

/** Throws when this attempt should not reach the auth provider at all.
 * Call it BEFORE verifying the password, never after: counting only
 * failures lets an attacker with one valid credential reset the window at
 * will. */
export async function guardLoginAttempt(email: string): Promise<void> {
  const byIp = await rateLimit(await callerKey("login"), LOGIN_IP_LIMIT, LOGIN_IP_WINDOW);
  if (!byIp.allowed) throw new Error(LOGIN_THROTTLED);

  const byAccount = await rateLimit(
    loginAccountKey(email), LOGIN_ACCOUNT_LIMIT, LOGIN_ACCOUNT_WINDOW,
  );
  if (!byAccount.allowed) throw new Error(LOGIN_THROTTLED);
}
