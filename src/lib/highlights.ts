/* THE SHORT SELLING POINTS, AS TEXT AND AS A LIST.
 *
 * The product page draws a handful of ticked one-liners beside the
 * description. They are stored as an array (supabase/product-highlights.sql)
 * and typed as a textarea, one per line, because a repeater with an "add
 * another" button for six words each is more machinery than the thing
 * deserves.
 *
 * THE LIMITS ARE THE DATABASE'S. products_highlights_sane refuses more
 * than MAX_HIGHLIGHTS entries, or any entry longer than MAX_HIGHLIGHT_LEN,
 * and a check constraint that fires is a 500 and a lost form. Trimming
 * here means the shop is told before it saves rather than after -- the
 * same numbers in both places, stated once here and quoted in the SQL.
 */

/** Twelve ticks is already more than anybody reads. */
export const MAX_HIGHLIGHTS = 12;
/** A line that still fits one column on a phone. */
export const MAX_HIGHLIGHT_LEN = 120;

/** Textarea -> column. Blank lines are skipped rather than stored: a
 *  double return while typing is not an empty bullet. */
export function parseHighlights(text: string): string[] {
  return (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, MAX_HIGHLIGHTS)
    .map((l) => l.slice(0, MAX_HIGHLIGHT_LEN));
}

/** Column -> textarea. Tolerates the null a database without the column
 *  hands back, and anything that is not a list of strings. */
export function highlightsText(list: readonly unknown[] | null | undefined): string {
  if (!Array.isArray(list)) return "";
  return list.filter((x): x is string => typeof x === "string").join("\n");
}

/** What the form says when somebody pastes a supplier's sheet in. Null
 *  when there is nothing to say, so the caller can render nothing. */
export function highlightsWarning(text: string): "many" | "long" | null {
  const lines = (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > MAX_HIGHLIGHTS) return "many";
  if (lines.some((l) => l.length > MAX_HIGHLIGHT_LEN)) return "long";
  return null;
}
