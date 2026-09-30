import type { Lang, Settings } from "@/lib/types";

/** The shop's one-line description, in the reader's language.
 *
 * One column per language, and the choice between them was written out
 * inline wherever it was needed -- twice in Hero.tsx alone. Here once, so a
 * fourth caller is a call rather than a fourth copy of a conditional that
 * has to stay in step with the column names.
 *
 * THE TAGLINE IS NOT A TRANSLATED STRING. Everything else on the page comes
 * from lib/i18n.ts and is translated once for every shop; this is the one
 * piece of storefront prose that is a particular shop's own words, so it
 * can only come from the settings row. That is why adding Indonesian to
 * the interface did not put the headline into Indonesian: /id/shop showed
 * an Indonesian kicker and an Indonesian description over a Tetun
 * headline, which reads as a half-translated shop.
 */
export function taglineOf(settings: Settings, lang: Lang): string {
  const line =
    lang === "pt" ? settings.tagline_pt
    : lang === "en" ? settings.tagline_en
    /* Optional, because a shop that has not run
       supabase/tagline-indonesian.sql has no such column -- it reads
       undefined here and falls through, rather than throwing. */
    : lang === "id" ? settings.tagline_id
    : settings.tagline_tet;
  /* Falls back to Tetum rather than to nothing: a shop that filled in one
     language has said something, and showing a blank line to a reader in
     another is losing it for no reason. */
  return (line || settings.tagline_tet || "").trim();
}
