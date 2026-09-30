import type { Lang, Settings } from "@/lib/types";

/** The shop's one-line description, in the reader's language.
 *
 * Three columns, one per language, and the choice between them was
 * written out inline wherever it was needed -- twice in Hero.tsx alone.
 * Here once, so a fourth caller is a call rather than a fourth copy of a
 * conditional that has to stay in step with the column names.
 *
 * THERE IS NO tagline_id, and that is deliberate rather than forgotten.
 * The shop has four languages now (see lib/locale.ts), but these columns
 * are seeded by SQL and there is no box in Settings that writes any of
 * them -- so a fourth would be a column nobody can fill, bought at the
 * price of a migration every existing shop has to run before its legal
 * and tax facts load again (see SETTINGS_PUBLIC_EXTRAS in
 * lib/data/public.ts: one ungranted column fails the whole select). When
 * the tagline becomes something an owner types, it takes a fourth box and
 * this takes a fourth branch.
 */
export function taglineOf(settings: Settings, lang: Lang): string {
  const line =
    lang === "pt" ? settings.tagline_pt
    : lang === "en" ? settings.tagline_en
    : settings.tagline_tet;
  /* Falls back to Tetum rather than to nothing: a shop that filled in one
     language has said something, and showing a blank line to a reader in
     another is losing it for no reason. Indonesian lands here too. */
  return (line || settings.tagline_tet || "").trim();
}
