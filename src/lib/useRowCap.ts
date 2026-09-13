"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

/* FIVE ROWS, THEN IT SCROLLS -- measured rather than guessed.
 *
 * Every capped list in this admin sets a height in the stylesheet from a
 * row height somebody measured once (see --adm-item-h). That works while a
 * row is always the same height, and an order row is not: at 1280px it is
 * 56px, and somewhere around 710px the payment pills wrap under the
 * reference and it becomes 83px. WHERE that happens depends on the content
 * -- a long customer name moves it -- so there is no breakpoint to pin a
 * second number to. A fixed height is wrong at some width for every value
 * it could be given.
 *
 * So the rows are asked. The distance between the top of the first row and
 * the top of the one after the last visible one IS the height of that many
 * rows, whatever they contain, however they have wrapped, in any of the
 * three languages. Measured from bounding rects rather than offsetTop
 * because the list scrolls: both rects move together, so their difference
 * is unaffected by where it happens to be scrolled to.
 *
 * The stylesheet still carries an approximate cap, which is what applies
 * before this runs and if it never does. Being roughly right without
 * JavaScript beats sprawling.
 */

/** A sliver of the next row stays visible. It is the only thing on screen
 * that says the box scrolls at all -- a cap landing exactly on a row
 * boundary looks like the end of the list. */
const PEEK = 6;

export function useRowCap<T extends HTMLElement>(
  /** How many rows stay visible. */
  visible: number,
  /** Re-measure when this changes -- the row count, typically. */
  deps: unknown
): { ref: React.RefObject<T | null>; style: { maxHeight: string } | undefined } {
  const ref = useRef<T>(null);
  /** undefined = not measured yet, so the stylesheet's approximate cap
   * stands. A string once measured -- including "none", which is the whole
   * reason this is not a number: a short list has to actively TURN OFF the
   * fallback, not merely decline to set one. Four rows at 83px are 332px
   * and the fallback is 286px, so leaving it in place would scroll a list
   * that fits. */
  const [maxHeight, setMaxHeight] = useState<string | undefined>(undefined);
  // The width the current measurement was taken at. Setting a height
  // changes the element's size, which wakes the observer again; without
  // this the two would chase each other forever.
  const lastWidth = useRef(-1);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rows = el.children;
    // Nothing to cap: fewer rows than the window. "none" rather than
    // nothing, so the stylesheet's fallback is lifted -- see above.
    if (rows.length <= visible) { setMaxHeight("none"); return; }

    const first = rows[0].getBoundingClientRect().top;
    const cutoff = rows[visible].getBoundingClientRect().top;
    const height = cutoff - first;
    if (height > 0) setMaxHeight(`${Math.ceil(height) + PEEK}px`);
  }, [visible]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    lastWidth.current = -1;
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? -1;
      // Only a change of WIDTH can reflow a row. Height changes are this
      // hook's own doing.
      if (Math.abs(w - lastWidth.current) < 0.5) return;
      lastWidth.current = w;
      measure();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, deps]);

  return { ref, style: maxHeight ? { maxHeight } : undefined };
}
