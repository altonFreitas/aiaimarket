import type { Lang } from "./types";

/* THREE LANGUAGES, THREE URLS.
 *
 * 1,023 translated strings across Tetun, Portuguese and English were doing
 * ZERO search work, because all three rendered at one URL behind a cookie.
 * Googlebot indexed whichever language it happened to receive and could not
 * reach the other two at all -- for a shop serving a Tetun and Portuguese
 * speaking market with an English-speaking diaspora, the single largest
 * missed channel in the project.
 *
 * WHY A PREFIX AND NOT A DIRECTORY MOVE. The obvious implementation is to
 * move every public route into src/app/[lang]/, which is also a rewrite of
 * every internal href in the application and a chance to break each one.
 * The prefix is stripped in the proxy instead: /pt/p/sapatu renders exactly
 * what /p/sapatu renders, in Portuguese, and every existing route file and
 * every existing <Link> keeps working untouched.
 *
 * What Google needs is three distinct URLs that each reliably serve one
 * language, a self-referencing canonical on each, and an hreflang cluster
 * tying them together. That is what this produces. The unprefixed URL keeps
 * working for people who have one bookmarked, and canonicalises to the
 * prefixed form so it does not compete with it.
 *
 * No server-only import: the proxy, the metadata builders and the language
 * switch all need this, and it reads nothing.
 */

export const LOCALES = ["tet", "pt", "en"] as const;

/** The one served when nothing says otherwise. Tetun, because that is what
 * most of this shop's buyers read. */
export const DEFAULT_LOCALE: Lang = "tet";

/** BCP 47 for the hreflang attribute, which is not the same thing as the
 * cookie value: "tet" is right for Tetun, "pt-TL" says Portuguese as
 * written in Timor-Leste rather than in Portugal or Brazil. */
export const HREFLANG: Record<Lang, string> = {
  tet: "tet",
  pt: "pt-TL",
  en: "en",
};

export function isLocale(value: string | undefined | null): value is Lang {
  return value === "tet" || value === "pt" || value === "en";
}

/** Paths that never carry a locale.
 *
 * The admin and the seller back office are tools, not content: nobody
 * searches for them, they are behind a login, and giving them three URLs
 * each would triple the surface for no gain. /api is machine-facing. */
const UNPREFIXED = ["/admin", "/seller", "/api", "/_next", "/favicon"];

export function takesLocale(path: string): boolean {
  return !UNPREFIXED.some((p) => path === p || path.startsWith(p + "/"));
}

/** Splits "/pt/p/sapatu" into its locale and "/p/sapatu".
 *
 * Returns a null locale for a path that has none, which is the ordinary
 * case for every link already in the application. */
export function splitLocale(pathname: string): { locale: Lang | null; rest: string } {
  const [, first, ...others] = pathname.split("/");
  if (!isLocale(first)) return { locale: null, rest: pathname };
  const rest = "/" + others.join("/");
  return { locale: first, rest: rest === "/" ? "/" : rest.replace(/\/$/, "") };
}

/** The address of `path` in `lang`. Always prefixed, including the default
 * locale.
 *
 * A DEFAULT THAT IS NOT PREFIXED is the more common design and it is worse
 * here: it makes one language's URLs shaped differently from the other two,
 * so every link builder, every canonical and every sitemap entry needs a
 * special case, and the one that forgets it produces a duplicate. Three
 * languages, three prefixes, no exceptions. */
export function localePath(lang: Lang, path: string): string {
  const { rest } = splitLocale(path);
  if (!takesLocale(rest)) return rest;
  return rest === "/" ? `/${lang}` : `/${lang}${rest}`;
}

/** The hreflang cluster for one page: every language it exists in, plus
 * x-default.
 *
 * x-default points at the default locale rather than at the unprefixed URL.
 * It answers "what should somebody get when none of the listed languages
 * matches them", and the honest answer is the language this shop is
 * actually written in. */
export function localeAlternates(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const lang of LOCALES) out[HREFLANG[lang]] = localePath(lang, path);
  out["x-default"] = localePath(DEFAULT_LOCALE, path);
  return out;
}

/** The metadata every public page needs to be findable in three languages.
 *
 * canonical is SELF-REFERENCING -- /pt/p/x says its canonical is
 * /pt/p/x -- which is what makes the three siblings distinct pages rather
 * than duplicates of one. Pointing all three at one canonical would be
 * telling Google to index only that one, which is the bug being fixed.
 */
export function localeMetadata(lang: Lang, path: string): {
  alternates: { canonical: string; languages: Record<string, string> };
} {
  return {
    alternates: {
      canonical: localePath(lang, path),
      languages: localeAlternates(path),
    },
  };
}
