/* THE CHART OF ACCOUNTS.
 *
 * A CONTROLLED VOCABULARY, not free text. The point of an account is that
 * next year's total is comparable with this year's, and a free-text field
 * becomes "Hosting", "hosting", "Server" and "supabase" inside six months
 * -- four rows in a report that should be one.
 *
 * Deliberately short. A chart of accounts with sixty lines is one nobody
 * files against correctly; these are what a small online shop actually pays
 * for. `other` is the honest escape hatch rather than an invitation to
 * avoid choosing.
 *
 * Mirrored by is_expense_account() in supabase/operating-costs.sql, and a
 * test holds the two to each other -- so an account added in one place and
 * not the other fails loudly rather than rendering as a raw i18n key. That
 * is exactly how the delivery zones came to show "zone_z1" to shoppers.
 *
 * No server-only import: the expense form is a client component and the
 * profit and loss is computed on the server.
 */

export const EXPENSE_ACCOUNTS = [
  "hosting",
  "software",
  "domain",
  "bank_fees",
  "marketing",
  "staff",
  "premises",
  "transport",
  "professional",
  "tax",
  "equipment",
  "other",
] as const;

export type ExpenseAccount = (typeof EXPENSE_ACCOUNTS)[number];

export function isExpenseAccount(v: string | undefined | null): v is ExpenseAccount {
  return !!v && (EXPENSE_ACCOUNTS as readonly string[]).includes(v);
}

/** The i18n key naming an account. */
export function accountLabelKey(account: string): string {
  return "acct_" + account;
}

/** A one-line hint under the picker, so somebody filing a cost knows which
 * box it goes in without having to guess from the name alone. */
export function accountHintKey(account: string): string {
  return "acctHint_" + account;
}

/* WHICH ACCOUNTS ARE THE COST OF BEING ONLINE AT ALL.
 *
 * Grouped because it is the question the owner of a web shop actually asks
 * -- "what does the website itself cost me a month" -- and because those
 * three are the ones that bill whether or not anything sells. Everything
 * else scales with the business in some way; these are the floor. */
export const PLATFORM_ACCOUNTS: readonly ExpenseAccount[] = [
  "hosting", "software", "domain",
];

export function isPlatformCost(account: string): boolean {
  return (PLATFORM_ACCOUNTS as readonly string[]).includes(account);
}

export const CADENCES = ["monthly", "quarterly", "yearly"] as const;
export type Cadence = (typeof CADENCES)[number];

export function isCadence(v: string | undefined | null): v is Cadence {
  return !!v && (CADENCES as readonly string[]).includes(v);
}

/** How many times a year a cadence bills. Used to state a subscription's
 * annual cost, which is the number that makes "$25 a month" feel real. */
export const PER_YEAR: Record<Cadence, number> = {
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

export function annualCost(amount: number, cadence: Cadence): number {
  return amount * PER_YEAR[cadence];
}

/** The same cost expressed per month, so three subscriptions on three
 * different cadences can be added up and compared. */
export function monthlyCost(amount: number, cadence: Cadence): number {
  return (amount * PER_YEAR[cadence]) / 12;
}
