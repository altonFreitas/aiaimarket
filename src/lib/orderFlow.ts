import { FLOW } from "@/lib/utils";
import type { OrderStatus } from "@/lib/types";

/** The order-status rules, as a pure function.
 *
 * These rules previously existed twice — once in lib/actions/orders.ts for
 * the admin and once in lib/actions/seller-orders.ts for sellers — with a
 * comment on the second copy promising it was "mirrored exactly, not
 * reimplemented from scratch". That promise is exactly the kind that decays:
 * the next person to add a status only finds one of the two copies. One
 * implementation, two callers, and a test suite that can actually enumerate
 * the transitions.
 */

export type FlowVerdict = { ok: true } | { ok: false; reason: string };

export function checkOrderTransition(from: OrderStatus, to: OrderStatus): FlowVerdict {
  // Cancelled is fully terminal: an order cannot be pulled back into the
  // flow, and cannot be cancelled twice.
  if (from === "cancelled") {
    return { ok: false, reason: "This order has been cancelled and can no longer be changed" };
  }

  if (to === "cancelled") {
    if (from === "completed") {
      return { ok: false, reason: "This order can no longer be cancelled" };
    }
    return { ok: true };
  }

  const fromIdx = FLOW.indexOf(from);
  const toIdx = FLOW.indexOf(to);
  // An unknown status on either side means we cannot reason about order, so
  // we allow it rather than inventing a rule -- matching the original
  // behaviour, which only compared when both indexes resolved.
  if (fromIdx !== -1 && toIdx !== -1 && toIdx < fromIdx) {
    return { ok: false, reason: "Can't move an order back to an earlier status" };
  }
  return { ok: true };
}

/** Throwing wrapper for the server actions, which surface the message. */
export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  const verdict = checkOrderTransition(from, to);
  if (!verdict.ok) throw new Error(verdict.reason);
}
