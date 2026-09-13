"use client";
import {
  PERIOD_PRESETS, presetRange, activePreset, coincidingPresets,
  type PeriodPreset,
} from "@/lib/sales";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* ONE CLICK FOR THE QUESTION PEOPLE ACTUALLY ASK.
 *
 * Two date boxes can express any range and express none of them quickly.
 * These are the seven that get typed over and over, and each is a whole
 * calendar period, so two people reading the same screen mean the same
 * thing by it.
 *
 * WHY THE CHOSEN PRESET IS PASSED IN RATHER THAN WORKED OUT HERE. Deriving
 * the lit chip from the date range alone is lossy, because the same range
 * can be several presets: on a Monday "this week" is only today, on the 1st
 * so is "this month", and on 1 January today, this month, this quarter and
 * this year are one identical day. Matching by range then lights whichever
 * comes first in the list, so the later chips can never light -- and since
 * clicking one sets the range it is already on, React re-renders nothing
 * and the chip looks broken. That is exactly what happened to "This week"
 * on Monday 14 September 2026.
 *
 * So the parent remembers what was clicked and hands it back. Deriving from
 * the range is kept only as the fallback for a range that arrived some
 * other way -- a typed date, a restored filter -- which is the case it was
 * always right for.
 */

export default function PeriodChips({
  lang, from, to, today, chosen, onPick, onClear,
}: {
  lang: Lang;
  from?: string;
  to?: string;
  /** Today, from the server. Never the viewer's clock: an admin with a
   * skewed device would otherwise get a different "today" than the data. */
  today: string;
  /** What was last clicked, or null when the range was set some other way. */
  chosen: PeriodPreset | null;
  onPick: (p: PeriodPreset, range: { from: string; to: string }) => void;
  /** Back to everything, clearing both dates. */
  onClear: () => void;
}) {
  // What was clicked wins. Falling back to the range only matters on first
  // render and after a hand-typed date, and there the ambiguity is harmless
  // because nobody clicked anything to be contradicted about.
  const lit = chosen ?? activePreset(from, to, today);
  const sameAs = lit ? coincidingPresets(lit, today) : [];

  return (
    <>
      <div className="bar preset-bar">
        {PERIOD_PRESETS.map((p) => (
          <button key={p} type="button"
            className={"chip" + (lit === p ? " is-on" : "")}
            aria-pressed={lit === p}
            onClick={() => onPick(p, presetRange(p, today))}>
            {t("range_" + p, lang)}
          </button>
        ))}
        <button type="button"
          className={"chip" + (!from && !to ? " is-on" : "")}
          aria-pressed={!from && !to}
          onClick={onClear}>
          {t("allTime", lang)}
        </button>
      </div>

      {/* Said out loud on the days it matters. Without this, clicking "this
          week" on a Monday moves the highlight and changes not one number,
          which reads as a bug rather than as the truth about Mondays. */}
      {sameAs.length > 1 && (
        <p className="hint period-note">
          {t("periodSameAs", lang)
            .replace("{a}", t("range_" + lit, lang))
            .replace("{b}", sameAs.filter((p) => p !== lit)
              .map((p) => t("range_" + p, lang)).join(", "))}
        </p>
      )}
    </>
  );
}
