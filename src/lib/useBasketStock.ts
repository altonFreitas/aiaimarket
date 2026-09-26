"use client";
import { useEffect, useRef } from "react";
import { basketAvailability } from "@/lib/actions/basket";
import type { BasketLine } from "./useBasket";

/** Re-reads what the shelf holds for everything in the basket, once, when a
 * screen that can change quantities opens.
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
export function useBasketStock(
  lines: BasketLine[], ready: boolean,
  applyStock: (fresh: Record<string, number>) => void
): void {
  const done = useRef(false);
  useEffect(() => {
    // `ready` false means the browser's basket has not been read yet, so
    // asking now would ask about nothing.
    if (!ready || done.current) return;
    if (!lines.length) return;
    done.current = true;
    let live = true;
    basketAvailability(lines.map((l) => ({ id: l.id, size: l.size })))
      .then((fresh) => { if (live && fresh && Object.keys(fresh).length) applyStock(fresh); })
      .catch(() => { /* keeps the ceilings it has */ });
    return () => { live = false; };
  }, [ready, lines, applyStock]);
}
