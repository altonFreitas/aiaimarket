/* WHAT THE VISITOR HAS ACTUALLY AGREED TO.
 *
 * This shop sets no analytics and no advertising cookies today -- grepped
 * before writing this, and there is a test that keeps it true. The old
 * banner said exactly that and offered a single "Got it", on the argument
 * that a Reject button with nothing behind it is theatre.
 *
 * That argument was right about the BUTTON and wrong about the MECHANISM.
 * The reason a shop ends up tracking people without consent is never a
 * decision; it is somebody pasting a snippet into a layout six months
 * later, on a site where nothing was ever built to stop them. So the
 * categories and the store are real now, they default to OFF, and
 * hasConsent() is the gate anything of that kind has to pass.
 *
 * The dialog is therefore not describing tracking that exists. It is
 * describing what each category WOULD cover, and recording an answer that
 * is binding the day one of them stops being empty.
 *
 * IN localStorage, NOT IN A COOKIE. Setting a cookie to record what
 * somebody said about cookies is a joke the reader is not in on -- and it
 * would be one more thing the notice has to declare.
 */

export const CONSENT_KEY = "loja:consent:v1";

/** Essential is not listed: it is not a choice. It covers the language you
 * picked and a sign-in session for shop staff, both of which exist because
 * the visitor asked for them. */
export const OPTIONAL_CATEGORIES = ["analytics", "marketing"] as const;
export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number];

export interface Consent {
  analytics: boolean;
  marketing: boolean;
  /** When the answer was given, so a shop can tell a stale record from a
   * fresh one if its policy ever changes. */
  at?: string;
}

/** Nobody has said yes to anything yet.
 *
 * OFF, and that is the whole point: a visitor who has not answered has not
 * consented, and a default of true would make the dialog a formality. */
export const NO_CONSENT: Consent = { analytics: false, marketing: false };

/** What was stored, or null when the question has never been answered.
 *
 * null and "answered no to everything" are DIFFERENT: the first means ask,
 * the second means do not ask again. Collapsing them is how a dialog comes
 * back on every page load for somebody who already declined. */
export function parseConsent(raw: string | null | undefined): Consent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    /* An ARRAY is an object and is not falsy, so `typeof v !== "object"`
       alone let "[1,2]" through and produced a consent record out of it.
       Only a plain object is an answer this shop wrote. */
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    return {
      // Anything that is not exactly true reads as false. A stored "1",
      // "yes" or 1 is not an answer this shop wrote.
      analytics: v.analytics === true,
      marketing: v.marketing === true,
      at: typeof v.at === "string" ? v.at : undefined,
    };
  } catch {
    /* Corrupted, or written by something else. Treat it as unanswered and
       ask again rather than inventing a permission. */
    return null;
  }
}

export function readConsent(): Consent | null {
  try { return parseConsent(localStorage.getItem(CONSENT_KEY)); } catch { return null; }
}

export function saveConsent(c: Consent): void {
  const body: Consent = {
    analytics: c.analytics === true,
    marketing: c.marketing === true,
    at: new Date().toISOString(),
  };
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(body)); } catch { /* private mode */ }
}

/** THE GATE. Anything that is not essential must pass this before it
 * loads -- not after, and not beside it.
 *
 * Returns false when the question has not been answered, which is the
 * answer that matters: silence is not permission.
 */
export function hasConsent(category: OptionalCategory): boolean {
  const c = readConsent();
  return c ? c[category] === true : false;
}
