import type { Lang, Settings } from "@/lib/types";

/** The shop's one-line description, in the reader's language.
 *
 * Three columns, one per language, and the choice between them was
 * written out inline wherever it was needed -- twice in Hero.tsx alone.
 * Here once, so a fourth caller is a call rather than a fourth copy of a
 * conditional that has to stay in step with the column names. */
export function taglineOf(settings: Settings, lang: Lang): string {
  const line =
    lang === "pt" ? settings.tagline_pt
    : lang === "en" ? settings.tagline_en
    : settings.tagline_tet;
  /* Falls back to Tetum rather than to nothing: a shop that filled in one
     language has said something, and showing a blank line to a reader in
     another is losing it for no reason. */
  return (line || settings.tagline_tet || "").trim();
}
