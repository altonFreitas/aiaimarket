/** Money handling for the payment layer.
 *
 * Orders store dollars as Postgres `numeric(10,2)` (exact decimal, no float
 * error). Card networks and every gateway built on them work in MINOR UNITS
 * — integer cents — because "19.99" cannot be represented exactly in binary
 * floating point and a half-cent drift on a reconciliation report is a real
 * accounting problem, not a rounding curiosity.
 *
 * Everything crossing the boundary into a provider goes through here, so
 * there is exactly one place where the conversion (and its rounding rule)
 * lives, and it is covered by tests.
 */

/** Currencies this store can quote. USD is the spec's currency (§G5). */
export const SUPPORTED_CURRENCIES = ["USD"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

/** Decimal places per currency. Not every currency has 2 — JPY has 0, KWD
 * has 3 — so this is a lookup rather than a hardcoded 100 multiplier, which
 * is the bug that bites the moment a second currency is added. */
const MINOR_UNIT_DIGITS: Record<Currency, number> = { USD: 2 };

/** Largest order this store will ever hand to a gateway. A guard, not a
 * business rule: it catches a corrupted total before it becomes a real
 * authorization request. */
export const MAX_MINOR_UNITS = 100_000_00; // $100,000.00

export function isSupportedCurrency(v: string): v is Currency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(v);
}

/**
 * Dollars -> integer cents.
 *
 * `Math.round` (not trunc/floor) because 19.99 * 100 evaluates to
 * 1998.9999999999998 in IEEE-754: truncating would silently undercharge by
 * a cent on a large share of real prices.
 */
export function toMinorUnits(amount: number, currency: Currency = "USD"): number {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new Error("Payment amount is not a finite number");
  }
  if (amount <= 0) {
    throw new Error("Payment amount must be greater than zero");
  }
  const factor = 10 ** MINOR_UNIT_DIGITS[currency];
  const minor = Math.round(amount * factor);
  if (minor <= 0) {
    throw new Error("Payment amount rounds to zero");
  }
  if (minor > MAX_MINOR_UNITS) {
    throw new Error("Payment amount exceeds the maximum this store accepts");
  }
  return minor;
}

/** Integer cents -> dollars, for display and for writing back to `orders`. */
export function fromMinorUnits(minor: number, currency: Currency = "USD"): number {
  if (!Number.isInteger(minor)) {
    throw new Error("Minor units must be an integer");
  }
  const factor = 10 ** MINOR_UNIT_DIGITS[currency];
  return minor / factor;
}

/** The string form a gateway expects in its JSON body: a fixed-precision
 * decimal, never a float literal. `(19.99).toString()` is fine today but
 * `(0.1 + 0.2).toString()` is "0.30000000000000004" — formatting from the
 * integer removes that whole class of problem. */
export function formatMinorUnits(minor: number, currency: Currency = "USD"): string {
  return fromMinorUnits(minor, currency).toFixed(MINOR_UNIT_DIGITS[currency]);
}

/**
 * Does the amount a provider reported back match what we asked for?
 *
 * Called on every webhook and status poll. A mismatch means either a
 * partial capture, a currency conversion we did not ask for, or a tampered
 * payload — in all three cases the order must NOT be marked paid on the
 * strength of that message alone.
 */
export function amountsMatch(expectedMinor: number, reportedMinor: number): boolean {
  return Number.isInteger(expectedMinor) && Number.isInteger(reportedMinor) && expectedMinor === reportedMinor;
}
