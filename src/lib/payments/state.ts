/** The payment state machine.
 *
 * Deliberately a pure module with no database and no network in it, for the
 * same reason the order-status rules were pulled out into lib/orderFlow.ts:
 * money-moving transitions are exactly the logic that must be exhaustively
 * unit-tested, and that is only cheap when the rules are separable from the
 * I/O around them.
 *
 * Gateways deliver events out of order and more than once. A webhook for
 * AUTHORIZED can easily arrive after the CAPTURED one it precedes; a
 * provider retrying a delivery will send the same event again tomorrow.
 * So the rule is not "apply what the provider says" — it is "apply it only
 * if it moves this payment forward".
 */

export type PaymentStatus =
  | "initiated"   // row created, buyer not yet sent to the gateway
  | "pending"     // buyer is at the gateway; outcome unknown
  | "authorized"  // funds held, not yet taken
  | "captured"    // money actually taken -- the only status that means "paid"
  | "failed"      // gateway declined
  | "cancelled"   // buyer abandoned, or we voided it
  | "refunded";   // captured, then given back

/** Statuses from which nothing further can happen (refunded is the one
 * legal exit from captured). */
const TERMINAL: ReadonlySet<PaymentStatus> = new Set(["failed", "cancelled", "refunded"]);

/** Explicit adjacency rather than an ordered list: this graph genuinely
 * branches (authorize-then-capture is two hops, but many gateways report a
 * single CAPTURED with no AUTHORIZED in between), so "index must increase"
 * would be the wrong model. */
const ALLOWED: Record<PaymentStatus, readonly PaymentStatus[]> = {
  initiated: ["pending", "authorized", "captured", "failed", "cancelled"],
  pending: ["authorized", "captured", "failed", "cancelled"],
  authorized: ["captured", "failed", "cancelled"],
  captured: ["refunded"],
  failed: [],
  cancelled: [],
  refunded: [],
};

export function isTerminalPaymentStatus(s: PaymentStatus): boolean {
  return TERMINAL.has(s);
}

/** "Has this order actually been paid for?" — the single question the rest
 * of the app should ask. Nothing except `captured` counts: an authorization
 * is a hold that can expire or be voided, and shipping against one is how
 * you end up delivering goods you were never paid for. */
export function isPaidStatus(s: PaymentStatus): boolean {
  return s === "captured";
}

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return false; // a repeat delivery of the same event
  return ALLOWED[from].includes(to);
}

/**
 * Decide what to do with an incoming provider event.
 *
 * Returns an explicit verdict rather than throwing, because "ignore this"
 * is the correct and *expected* outcome for a duplicate webhook — a retry
 * is normal provider behaviour, not an error, and treating it as one means
 * the provider sees a 500 and retries harder.
 */
export type TransitionVerdict =
  | { action: "apply"; to: PaymentStatus }
  | { action: "ignore"; reason: string };

export function decideTransition(from: PaymentStatus, to: PaymentStatus): TransitionVerdict {
  if (from === to) {
    return { action: "ignore", reason: "duplicate event — payment is already in this state" };
  }
  if (isTerminalPaymentStatus(from)) {
    return { action: "ignore", reason: `payment is terminal (${from}) and cannot change` };
  }
  if (!canTransitionPayment(from, to)) {
    // Out-of-order delivery: e.g. AUTHORIZED arriving after CAPTURED.
    // Ignoring is right — the later state is already recorded.
    return { action: "ignore", reason: `illegal transition ${from} -> ${to}` };
  }
  return { action: "apply", to };
}

/** How a payment's status maps onto the order's own `pay_status` column,
 * which is what the admin UI and the buyer's dashboard already read. Keeps
 * the existing manual-payment vocabulary intact instead of introducing a
 * second, competing notion of "paid" alongside it. */
export function orderPayStatusFor(s: PaymentStatus): "unpaid" | "paid" | "refunded" {
  if (s === "captured") return "paid";
  if (s === "refunded") return "refunded";
  return "unpaid";
}
