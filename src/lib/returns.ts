/* WHAT CAME BACK.
 *
 * Every dashboard in this application measures things going out. Returns
 * were recorded faithfully -- supabase/returns.sql has been writing a proper
 * document per return since it shipped, restocking through the ledger, and
 * refusing to let more come back than went out -- and then nobody could look
 * at them. The only screen that showed a return was the panel on one order,
 * which answers "what happened to this parcel" and never "is the shop
 * bleeding, and on what".
 *
 * The goods travel in BOTH directions and the two are separate businesses:
 *
 *   a customer return  goods arrive, stock goes up, the shop pays money out.
 *                      A cost, and a signal about a listing or a supplier.
 *   a supplier return  goods leave, stock goes down, money is owed INWARD.
 *                      An asset, and one that quietly goes unclaimed.
 *
 * Adding them together would produce a number meaning nothing at all, so
 * nothing here does. Two shapes, one file, because they are asked about on
 * the same screen and the shop's own eye moves between them.
 *
 * Pure: given rows, it returns figures. No I/O, so every rule is testable
 * without a database.
 */

export const RETURN_REASONS = [
  "damaged", "wrong_item", "not_as_described", "changed_mind", "other",
] as const;
export type CustomerReturnReason = (typeof RETURN_REASONS)[number];

export const SUPPLIER_RETURN_REASONS = [
  "damaged", "wrong_item", "not_as_described", "over_delivery", "expired", "other",
] as const;
export type SupplierReturnReason = (typeof SUPPLIER_RETURN_REASONS)[number];

export const SUPPLIER_RETURN_STATUSES = [
  "draft", "sent", "credited", "rejected", "cancelled",
] as const;
export type SupplierReturnStatus = (typeof SUPPLIER_RETURN_STATUSES)[number];

/** Reasons that say the shop, its listing or its supplier got something
 * wrong -- as opposed to a buyer simply changing their mind.
 *
 * The distinction matters more than any total here. A shop whose returns
 * are all "changed mind" has a normal retail business; one whose returns
 * are all "not as described" has a catalogue problem it can fix this week,
 * and the two are indistinguishable in a single return-rate figure. */
export const FAULT_REASONS: readonly CustomerReturnReason[] = [
  "damaged", "wrong_item", "not_as_described",
];

export function isFaultReason(reason: string): boolean {
  return (FAULT_REASONS as readonly string[]).includes(reason);
}

export const returnReasonKey = (r: string) => `returnReason_${r}`;
export const supplierReasonKey = (r: string) => `supReason_${r}`;
export const supplierStatusKey = (s: string) => `supRetStatus_${s}`;

/* ---------------------------------------------------------------------------
 * The rows, in the shape the screen needs them
 * ------------------------------------------------------------------------ */

export interface ReturnLine {
  productId: string | null;
  productName: string;
  qty: number;
  /** False for damaged goods: back in the building, not on the shelf. */
  restock: boolean;
}

export interface CustomerReturnRow {
  id: string;
  ref: string;
  orderId: string;
  orderRef: string;
  reason: string;
  note: string;
  /** In the order's currency, which for this shop is USD. */
  refundTotal: number;
  /** Null while a refund is agreed and not yet settled at the gateway. */
  refundedAt: string | null;
  createdAt: string;
  lines: ReturnLine[];
}

export interface SupplierReturnLine {
  productId: string | null;
  productName: string;
  qty: number;
  unitCost: number;
  /** False for goods quarantined on arrival, which never entered stock. */
  fromStock: boolean;
}

export interface SupplierReturnRow {
  id: string;
  ref: string;
  supplierId: string;
  supplierName: string;
  poNumber: string | null;
  reason: string;
  status: SupplierReturnStatus;
  note: string;
  creditExpectedUsd: number;
  creditReceivedUsd: number;
  creditedAt: string | null;
  shippedOn: string | null;
  createdAt: string;
  lines: SupplierReturnLine[];
}

/** A request a buyer raised and nobody has answered yet. */
export interface OpenRequestRow {
  id: string;
  ref: string;
  orderRef: string;
  reason: string;
  createdAt: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function unitsIn(r: { lines: readonly { qty: number }[] }): number {
  return r.lines.reduce((a, l) => a + (Number(l.qty) || 0), 0);
}

/* ---------------------------------------------------------------------------
 * The customer side
 * ------------------------------------------------------------------------ */

export interface CustomerReturnStats {
  /** Documents, not units: two shirts on one return is one return. */
  count: number;
  units: number;
  /** Agreed, whether or not the money has moved. */
  refundTotal: number;
  /** Settled -- the money actually left. */
  refundSettled: number;
  /** Agreed and not yet settled. The shop's real liability today. */
  refundPending: number;
  /** Units that went back on the shelf, over units that came back at all.
   * Null when nothing has come back: a shop with no returns has no rate,
   * and showing 0% would read as "we recover nothing". */
  restockRate: number | null;
  /** Returns blaming the shop, its listing or its supplier, over all
   * returns. Null when nothing has come back. */
  faultRate: number | null;
  /** Returns over orders. Null when there are no orders -- a division the
   * screen must not perform on an empty shop. */
  returnRate: number | null;
}

export function customerReturnStats(
  returns: readonly CustomerReturnRow[], orderCount: number
): CustomerReturnStats {
  let units = 0, restocked = 0, refundTotal = 0, refundSettled = 0, fault = 0;

  for (const r of returns) {
    for (const l of r.lines) {
      const q = Number(l.qty) || 0;
      units += q;
      if (l.restock) restocked += q;
    }
    const amount = Number(r.refundTotal) || 0;
    refundTotal += amount;
    if (r.refundedAt) refundSettled += amount;
    if (isFaultReason(r.reason)) fault += 1;
  }

  return {
    count: returns.length,
    units,
    refundTotal: round2(refundTotal),
    refundSettled: round2(refundSettled),
    refundPending: round2(refundTotal - refundSettled),
    restockRate: units > 0 ? restocked / units : null,
    faultRate: returns.length > 0 ? fault / returns.length : null,
    returnRate: orderCount > 0 ? returns.length / orderCount : null,
  };
}

export interface ReasonRow {
  reason: string;
  count: number;
  units: number;
  value: number;
  share: number;
}

/** Why goods came back, biggest first.
 *
 * Ranked by number of returns rather than by money, because the reason is a
 * diagnosis and a diagnosis is about how often, not how expensive. The
 * money is carried along beside it. */
export function byReason(returns: readonly CustomerReturnRow[]): ReasonRow[] {
  const m = new Map<string, { count: number; units: number; value: number }>();
  for (const r of returns) {
    const e = m.get(r.reason) || { count: 0, units: 0, value: 0 };
    e.count += 1;
    e.units += unitsIn(r);
    e.value += Number(r.refundTotal) || 0;
    m.set(r.reason, e);
  }
  const total = returns.length || 1;
  return [...m.entries()]
    .map(([reason, e]) => ({
      reason, count: e.count, units: e.units,
      value: round2(e.value), share: e.count / total,
    }))
    .sort((a, b) => b.count - a.count);
}

export interface ReturnedProductRow {
  productId: string;
  name: string;
  units: number;
  returns: number;
  /** How many of those units were not fit to sell again. The number that
   * turns "this sells and comes back" into "this arrives broken". */
  scrapped: number;
  share: number;
}

/** What comes back most, by units.
 *
 * Lines with no product -- a product deleted since -- are dropped rather
 * than grouped under a blank name, because a bar labelled "" tells nobody
 * anything and would frequently be the tallest one. */
export function mostReturnedProducts(
  returns: readonly CustomerReturnRow[]
): ReturnedProductRow[] {
  const m = new Map<string, { name: string; units: number; returns: number; scrapped: number }>();
  for (const r of returns) {
    const seen = new Set<string>();
    for (const l of r.lines) {
      if (!l.productId) continue;
      const e = m.get(l.productId)
        || { name: l.productName || "", units: 0, returns: 0, scrapped: 0 };
      const q = Number(l.qty) || 0;
      e.units += q;
      if (!l.restock) e.scrapped += q;
      if (e.name === "" && l.productName) e.name = l.productName;
      if (!seen.has(l.productId)) { e.returns += 1; seen.add(l.productId); }
      m.set(l.productId, e);
    }
  }
  const total = [...m.values()].reduce((a, e) => a + e.units, 0) || 1;
  return [...m.entries()]
    .map(([productId, e]) => ({
      productId, name: e.name, units: e.units, returns: e.returns,
      scrapped: e.scrapped, share: e.units / total,
    }))
    .sort((a, b) => b.units - a.units);
}

/* ---------------------------------------------------------------------------
 * The supplier side
 * ------------------------------------------------------------------------ */

/** Statuses where the claim is still live. A cancelled or rejected claim is
 * finished, whatever it says about the money. */
const OPEN_STATUSES: readonly SupplierReturnStatus[] = ["draft", "sent"];

export interface SupplierReturnStats {
  count: number;
  units: number;
  /** What the shop has claimed, across every live and settled return. */
  creditExpected: number;
  /** What actually arrived. */
  creditReceived: number;
  /** Claimed, still live, and not yet in hand. THE number on this half of
   * the screen: it is money the shop is owed and may be about to forget. */
  creditOutstanding: number;
  /** Claims sent and not answered. */
  awaiting: number;
  /** Claims the supplier refused. Worth its own figure: a supplier who
   * rejects everything is a supplier decision, not a paperwork detail. */
  rejected: number;
  /** Credit received over credit claimed, across settled and live claims.
   * Null when nothing has been claimed. */
  recoveryRate: number | null;
}

export function supplierReturnStats(
  returns: readonly SupplierReturnRow[]
): SupplierReturnStats {
  let units = 0, expected = 0, received = 0, outstanding = 0;
  let awaiting = 0, rejected = 0;

  for (const r of returns) {
    if (r.status === "cancelled") continue;
    units += unitsIn(r);
    const exp = Number(r.creditExpectedUsd) || 0;
    const got = Number(r.creditReceivedUsd) || 0;
    expected += exp;
    received += got;
    if (OPEN_STATUSES.includes(r.status)) {
      // Whatever is claimed and not in hand, including the shortfall on a
      // claim that was answered short. A partial credit is an unfinished
      // argument, not a closed one.
      outstanding += Math.max(0, exp - got);
      if (r.status === "sent") awaiting += 1;
    }
    if (r.status === "rejected") rejected += 1;
  }

  const live = returns.filter((r) => r.status !== "cancelled");
  return {
    count: live.length,
    units,
    creditExpected: round2(expected),
    creditReceived: round2(received),
    creditOutstanding: round2(outstanding),
    awaiting,
    rejected,
    recoveryRate: expected > 0 ? received / expected : null,
  };
}

export interface SupplierRankRow {
  supplierId: string;
  name: string;
  returns: number;
  units: number;
  creditExpected: number;
  creditOutstanding: number;
  share: number;
}

/** Which suppliers the shop sends most back to.
 *
 * Ranked by the value claimed rather than by count: one carton of faulty
 * phones matters more than twenty claims over packaging, and the shop's
 * next conversation with a supplier is about money. */
export function bySupplier(returns: readonly SupplierReturnRow[]): SupplierRankRow[] {
  const m = new Map<string, Omit<SupplierRankRow, "supplierId" | "share">>();
  for (const r of returns) {
    if (r.status === "cancelled") continue;
    const e = m.get(r.supplierId)
      || { name: r.supplierName || "", returns: 0, units: 0, creditExpected: 0, creditOutstanding: 0 };
    e.returns += 1;
    e.units += unitsIn(r);
    const exp = Number(r.creditExpectedUsd) || 0;
    const got = Number(r.creditReceivedUsd) || 0;
    e.creditExpected += exp;
    if (OPEN_STATUSES.includes(r.status)) e.creditOutstanding += Math.max(0, exp - got);
    if (e.name === "" && r.supplierName) e.name = r.supplierName;
    m.set(r.supplierId, e);
  }
  const total = [...m.values()].reduce((a, e) => a + e.creditExpected, 0) || 1;
  return [...m.entries()]
    .map(([supplierId, e]) => ({
      supplierId, name: e.name, returns: e.returns, units: e.units,
      creditExpected: round2(e.creditExpected),
      creditOutstanding: round2(e.creditOutstanding),
      share: e.creditExpected / total,
    }))
    .sort((a, b) => b.creditExpected - a.creditExpected);
}

/** Claims sent and unanswered, oldest first.
 *
 * Age is the point. A claim raised three months ago that nobody chased is
 * worth more attention than one raised on Friday for twice the money, and
 * sorting by value would bury it. */
export function chaseList(
  returns: readonly SupplierReturnRow[], today = new Date()
): Array<SupplierReturnRow & { ageDays: number; outstanding: number }> {
  const now = today.getTime();
  return returns
    .filter((r) => OPEN_STATUSES.includes(r.status) && !r.creditedAt)
    .map((r) => ({
      ...r,
      ageDays: Math.max(0, Math.floor(
        (now - new Date(r.shippedOn || r.createdAt).getTime()) / 86_400_000)),
      outstanding: round2(Math.max(0,
        (Number(r.creditExpectedUsd) || 0) - (Number(r.creditReceivedUsd) || 0))),
    }))
    .sort((a, b) => b.ageDays - a.ageDays);
}

/* ---------------------------------------------------------------------------
 * Both sides, over time
 * ------------------------------------------------------------------------ */

export interface ReturnMonth {
  month: string;
  customer: number;
  supplier: number;
}

/** Returns per calendar month, both directions, over the months given.
 *
 * Two series on one axis because the shop's question is whether either is
 * getting worse, and a month is the smallest window in which a handful of
 * returns means anything at all. */
export function monthlyReturns(
  customer: readonly CustomerReturnRow[],
  supplier: readonly SupplierReturnRow[],
  months: readonly string[]
): ReturnMonth[] {
  const c = new Map<string, number>();
  const s = new Map<string, number>();
  for (const r of customer) {
    const m = (r.createdAt || "").slice(0, 7);
    c.set(m, (c.get(m) || 0) + 1);
  }
  for (const r of supplier) {
    if (r.status === "cancelled") continue;
    const m = (r.shippedOn || r.createdAt || "").slice(0, 7);
    s.set(m, (s.get(m) || 0) + 1);
  }
  return months.map((month) => ({
    month, customer: c.get(month) || 0, supplier: s.get(month) || 0,
  }));
}
