"use client";
import { useEffect, useRef } from "react";
import { basketLineFacts } from "@/lib/actions/basket";
import type { LineFacts } from "@/lib/actions/basket";
import type { BasketLine } from "./useBasket";

/** Re-reads what the CATALOGUE says about everything in the basket, once,
 * when a screen that shows or changes the basket opens.
 *
 * Two things go stale on a line, and for the same reason: both are copied
 * onto it when it is added, and a basket lives in the browser for as long
 * as the shopper leaves it there. The ceiling was already refreshed here.
 * The PHOTO was not -- so a product added before the shop uploaded its
 * picture kept a blank one for ever, and adding the same shirt again after
 * the upload put two lines in the cart, one with the photo and one without.
 *
 * The ceiling stored on a line is a snapshot from add-time, and a basket
 * lives in the browser for as long as the shopper leaves it there. Without
 * this the cart would enforce a number that was true last Tuesday, which is
 * a different wrong answer rather than a right one.
 *
 * ONCE PER SCREEN, not on every render and not on a timer: this is a
 * courtesy check before somebody fills in a form, not a live stock ticker,
 * and the database is what actually refuses an oversell.
 */
export function useBasketFacts(
  lines: BasketLine[], ready: boolean,
  applyFacts: (fresh: Record<string, LineFacts>) => void
): void {
  const done = useRef(false);
  useEffect(() => {
    // `ready` false means the browser's basket has not been read yet, so
    // asking now would ask about nothing.
    if (!ready || done.current) return;
    if (!lines.length) return;
    done.current = true;
    let live = true;
    basketLineFacts(lines.map((l) => ({ id: l.id, size: l.size })))
      .then((fresh) => { if (live && fresh && Object.keys(fresh).length) applyFacts(fresh); })
      .catch(() => { /* keeps the ceilings it has */ });
    return () => { live = false; };
  }, [ready, lines, applyFacts]);
}
