/* WHICH BUCKETS ON A TIME AXIS GET A WRITTEN LABEL.
 *
 * THE BUG THIS EXISTS FOR. The front page draws up to twenty-four buckets
 * in a tile a couple of hand-widths across. Every bucket carried its own
 * label, so twenty-four five-character dates were asked to share about six
 * hundred pixels -- twenty-five each, against a label needing thirty-odd.
 * They did not shrink; they WRAPPED, and the axis read
 *
 *     29/ 30/ 31/ 01/ 02/ 03/
 *     08  08  08  09  09  09
 *
 * which is worse than useless: two stacked rows of digits that have to be
 * mentally re-joined before they mean a date at all.
 *
 * WHAT IS NOT THE FIX. Dropping buckets would be -- every bar is a real
 * period and the gaps between them carry the shape. Shrinking the type
 * would be, too: the axis is already at the smallest size in the scale.
 *
 * SO THE BARS ALL STAY AND THE LABELS THIN OUT. Every charting library
 * does this, and no information is lost: each column keeps its own hover
 * title with the full date and both figures, so an unlabelled bar can
 * still be asked what it is.
 *
 * ANCHORED AT THE END, NOT THE START. Walking backwards from the last
 * bucket guarantees the most recent one is always written. That is the
 * bucket a shop looks at first -- "how did we do this month" -- and an
 * axis whose final column is blank invites the reader to count backwards
 * from a label three columns away to find out where "now" is.
 *
 * THE TWO NUMBERS BELOW WERE MEASURED, NOT CHOSEN. A date is about
 * thirty-three pixels of monospace; the narrowest panel this is drawn in
 * is a phone at three hundred and forty. Above eight buckets the columns
 * are narrower than a date, so the labels have to start overhanging and
 * thinning begins. Six is what fits once thinning starts: eight was tried
 * first and the last two dates ended up a pixel apart, because the label
 * on the final column is pulled inward to keep it from being clipped (see
 * .dchart-col:last-child in globals.css) and that shift eats the gap.
 */

/** Up to how many labels to write once the axis has to thin. */
const THINNED_TICKS = 6;

/** Up to how many buckets can each keep their own label. */
const LABEL_ALL_UP_TO = 8;

/** Indices that should show a label, given how many buckets there are.
 *
 * Returns every index while the columns are still wide enough to hold a
 * date, and otherwise every `step`th one counting back from the last.
 *
 * @param count how many buckets are plotted
 * @param maxTicks the most labels to write once thinning starts
 * @param fitAll up to how many buckets keep every label
 */
export function axisTicks(
  count: number, maxTicks = THINNED_TICKS, fitAll = LABEL_ALL_UP_TO
): Set<number> {
  const out = new Set<number>();
  if (!Number.isFinite(count) || count <= 0) return out;

  // Few enough that every column is wider than the date on it.
  if (maxTicks < 1 || count <= Math.max(fitAll, maxTicks)) {
    for (let i = 0; i < count; i++) out.add(i);
    return out;
  }

  const step = Math.ceil(count / maxTicks);
  for (let i = count - 1; i >= 0; i -= step) out.add(i);
  return out;
}
