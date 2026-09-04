import { LEGAL_DOCS, hasPlaceholders, type LegalSlug } from "@/lib/legal";

/* The things that must be true before this shop opens to the public, and
 * that nothing else on any screen reports.
 *
 * WHY THIS IS A SCREEN AND NOT A README.
 *
 * Each of these fails silently and fails outward. Not one of them throws,
 * logs anywhere the owner looks, or makes a page look broken -- they make it
 * look FINE, to the owner, while a shopper sees an unfinished policy or an
 * order confirmation never arrives. A shop can run for a week in any of
 * these states and only find out from a customer.
 *
 * DELIBERATELY NOT HERE: payment credentials and outstanding SQL files.
 * Those have panels of their own directly below this one, and a readiness
 * screen that restates them is two places to read the same fact and one
 * place to forget to update.
 */

export interface OpenCheck {
  /** i18n key naming what is being checked. */
  key: string;
  ok: boolean;
  /** i18n key saying what to do about it. */
  fixKey: string;
  /** The specific thing at fault -- a variable name, a list of pages --
   * shown as-is. A check that only says "not ready" is a check the owner
   * has to go and investigate. */
  detail: string;
}

/** True for a site URL that is set and is not the development default.
 *
 * "http://localhost:3000" is what layout.tsx, sitemap.ts and robots.ts fall
 * back to, so leaving it unset does not break a build or raise anything --
 * it publishes a sitemap and canonical URLs pointing at the owner's own
 * laptop, and Google indexes them that way. */
export function siteUrlOk(url: string): boolean {
  const u = url.trim();
  if (!u) return false;
  if (!/^https?:\/\//i.test(u)) return false;
  return !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(u);
}

/** Which policy pages still carry a FILL IN marker. */
export function unfinishedLegal(): LegalSlug[] {
  return (Object.keys(LEGAL_DOCS) as LegalSlug[]).filter((s) => hasPlaceholders(LEGAL_DOCS[s]));
}

export function openChecks(input: {
  siteUrl: string;
  storeName: string;
  contact: string;
}): OpenCheck[] {
  const legal = unfinishedLegal();
  return [
    {
      // The one that costs money silently. notifyOrderEvent() refuses to
      // send when there is no absolute origin -- correctly, because a
      // relative link is not tappable in a chat -- and says so with a
      // console.warn on a server the owner does not read. So every customer
      // orders and hears nothing, and every page advertises a canonical URL
      // on localhost. Nothing looks wrong from the admin side.
      key: "readySiteUrl",
      ok: siteUrlOk(input.siteUrl),
      fixKey: "readySiteUrlFix",
      detail: "NEXT_PUBLIC_SITE_URL" + (input.siteUrl.trim() ? ` = ${input.siteUrl.trim()}` : ""),
    },
    {
      // These pages already tell a SHOPPER they are unfinished, on purpose.
      // Nothing tells the owner.
      key: "readyLegal",
      ok: legal.length === 0,
      fixKey: "readyLegalFix",
      detail: legal.map((s) => `/legal/${s}`).join(", "),
    },
    {
      // Substituted into the policies as {STORE}. Empty, and the terms open
      // "This shop is , at ...".
      key: "readyStoreName",
      ok: input.storeName.trim().length > 0,
      fixKey: "readyStoreNameFix",
      detail: "{STORE}",
    },
    {
      // Substituted as {CONTACT}, which falls back to an em dash -- so the
      // privacy policy tells a shopper to contact "—" about their data.
      key: "readyContact",
      ok: input.contact.trim().length > 0,
      fixKey: "readyContactFix",
      detail: "{CONTACT}",
    },
  ];
}
