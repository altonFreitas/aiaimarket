/* WHERE ONE SELLER'S HALF OF AN ORDER HAS GOT TO.
 *
 * orders.status is a single column shared by everybody in the order, which
 * is why a mixed-seller order has always been read-only for the sellers in
 * it: there was nowhere for one of them to say "mine has gone out" without
 * claiming it for the other. That is the hard ceiling on calling this a
 * marketplace rather than a shop with guest listings.
 *
 * order_items.fulfilment_status is that somewhere, and this is what it
 * means. Pure and free of I/O, so the rules can be enumerated by a test
 * rather than discovered in production.
 *
 * A SHORTER VOCABULARY THAN THE ORDER'S, on purpose. orders.status runs
 * new → confirmed → preparing → out → arrived → completed, and most of
 * that is about DELIVERY, which the seller is not doing and cannot observe.
 * A seller knows whether they have packed the thing and handed it over.
 * Giving them 'arrived' would be inviting them to guess.
 */

export const FULFILMENT_FLOW = [
  "pending", "preparing", "ready", "dispatched",
] as const;

export type FulfilmentStatus = (typeof FULFILMENT_FLOW)[number] | "cancelled";

/** The i18n key for each, so the seller's screen and the admin's agree. */
export const FULFILMENT_LABEL: Record<FulfilmentStatus, string> = {
  pending: "fulPending",
  preparing: "fulPreparing",
  ready: "fulReady",
  dispatched: "fulDispatched",
  cancelled: "fulCancelled",
};

export type FulfilmentVerdict = { ok: true } | { ok: false; reason: string };

/** Forward-only, and terminal once cancelled -- the same shape as the
 * order's own rules, for the same reason: a status that can go backwards is
 * a status nobody can act on, because "ready" might mean it was ready and
 * then was not. */
export function checkFulfilmentTransition(
  from: FulfilmentStatus, to: FulfilmentStatus,
): FulfilmentVerdict {
  if (from === "cancelled") {
    return { ok: false, reason: "This line was cancelled and can no longer be changed" };
  }
  if (to === "cancelled") {
    // A seller withdrawing their own line. Allowed from anywhere except
    // after it has gone -- once it is with the courier it is the shop's
    // problem, and the honest answer is a return, not a retroactive
    // cancellation.
    if (from === "dispatched") {
      return { ok: false, reason: "This line has already been dispatched" };
    }
    return { ok: true };
  }

  const fromIdx = FULFILMENT_FLOW.indexOf(from as (typeof FULFILMENT_FLOW)[number]);
  const toIdx = FULFILMENT_FLOW.indexOf(to as (typeof FULFILMENT_FLOW)[number]);
  if (fromIdx === -1 || toIdx === -1) {
    return { ok: false, reason: "Unknown fulfilment status" };
  }
  if (toIdx < fromIdx) {
    return { ok: false, reason: "Can't move a line back to an earlier status" };
  }
  if (toIdx === fromIdx) {
    return { ok: false, reason: "That line is already at this status" };
  }
  return { ok: true };
}

export function assertFulfilmentTransition(
  from: FulfilmentStatus, to: FulfilmentStatus,
): void {
  const verdict = checkFulfilmentTransition(from, to);
  if (!verdict.ok) throw new Error(verdict.reason);
}

/* WHAT THE ORDER'S OWN STATUS SHOULD BE, given every seller's lines.
 *
 * The order still has a status, because the BUYER has one question --
 * "where is my order" -- and it does not become three questions because
 * the shop bought from three sellers. So the order's status is derived
 * from the slowest line in it: an order is 'preparing' while anybody is
 * still preparing, and only ready once everybody is.
 *
 * DERIVED, NOT AUTHORITATIVE. This suggests; it never overwrites. The
 * admin still moves the order through delivery, because delivery is the
 * one part no seller can see. What this stops is an order sitting at
 * 'new' for two days because nothing connected "both sellers have
 * dispatched" to "this is ready to go out".
 */
export function suggestedOrderStatus(
  lines: readonly FulfilmentStatus[],
): "new" | "preparing" | "out" | null {
  const live = lines.filter((l) => l !== "cancelled");
  // Every line withdrawn is not "ready to dispatch", it is a cancelled
  // order -- and that is a decision for a person, not a derivation.
  if (!live.length) return null;

  if (live.every((l) => l === "dispatched")) return "out";
  if (live.every((l) => l === "ready" || l === "dispatched")) return "preparing";
  if (live.some((l) => l !== "pending")) return "preparing";
  return "new";
}

/** How far through its lines an order is, for a progress line on screen. */
export function fulfilmentProgress(
  lines: readonly FulfilmentStatus[],
): { done: number; total: number } {
  const live = lines.filter((l) => l !== "cancelled");
  return {
    done: live.filter((l) => l === "dispatched").length,
    total: live.length,
  };
}
