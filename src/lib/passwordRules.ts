/* The rules about passwords, with no crypto behind them.
 *
 * Separate from lib/password.ts because the admin users screen is a client
 * component and needs the minimum length to say so in its hint. Importing
 * the hashing module for that would drag Node's crypto into the browser
 * bundle -- for one number. */

/** Long enough to be worth hashing. Matches the floor the environment
 * owner's password is already held to in lib/session.ts. */
export const MIN_PASSWORD_LEN = 12;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LEN) {
    return `Password must be at least ${MIN_PASSWORD_LEN} characters.`;
  }
  return null;
}
