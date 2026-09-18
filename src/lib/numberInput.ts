/* A NUMBER SOMEBODY IS STILL TYPING.
 *
 * Two problems, one place, because both are about the gap between what is
 * in the box and what the box means.
 *
 * ONE: a half-typed number is a string. "", "1.", "-" are not numbers yet,
 * and coercing every keystroke through Number() writes back whatever it
 * makes of them -- for an empty box, 0, which is why the Tax box could not
 * be cleared: deleting the last digit put a 0 straight back.
 *
 * TWO: THE DECIMAL COMMA. A number input steps and formats using the
 * BROWSER'S locale, and in Portuguese -- which is half of this shop's
 * audience -- the decimal separator is a comma. Pressing the spinner on the
 * Tax box produced "0,01", which Number() reads as NaN. Without this, a
 * shop typing "2,5" into its tax rate would have saved 0 and charged
 * nothing, with the box showing 2,5 and the hint underneath saying
 * "2.5 means 2.5%".
 */

/** The number a box currently means, or `fallback` while it means nothing.
 *
 * Accepts either decimal separator. A thousands separator is NOT accepted:
 * "1,234" is ambiguous -- one thousand two hundred and thirty-four in
 * English, one point two three four in Portuguese -- and guessing on a tax
 * rate or a price is worse than refusing.
 */
export function parseNum(v: string | number | null | undefined, fallback: number): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  const raw = String(v ?? "").trim();
  if (raw === "") return fallback;
  // One comma, used where a dot would be: treat it as the decimal point.
  const normalized = raw.includes(",") && !raw.includes(".")
    && raw.split(",").length === 2 ? raw.replace(",", ".") : raw;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : fallback;
}

/** The same text, written the way `Number()` reads it.
 *
 * Used on blur so the box settles into a form that means what it shows --
 * "0,01" becomes "0.01" once the person leaves it, matching the hint under
 * the field and what will actually be saved. An empty box is left empty:
 * rewriting it to "0" the moment it is touched is the original bug again.
 */
export function normalizeNumText(v: string, fallback: number): string {
  if (v.trim() === "") return v;
  const n = parseNum(v, Number.NaN);
  return Number.isFinite(n) ? String(n) : String(fallback);
}
