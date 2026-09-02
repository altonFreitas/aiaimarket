import type {
  PoCategory, PoPaymentStatus, PoStatus, PurchaseOrder, PurchaseOrderItem, Supplier,
} from "@/lib/types";

/* ---------------------------------------------------------------------------
 * Every procurement number the dashboard shows, computed here and nowhere
 * else. Pure functions over rows in, figures out -- no database, no clock
 * except the `today` each caller passes in, so the arithmetic that decides
 * whether a supplier looks reliable can be tested exhaustively.
 *
 * Two conventions hold throughout:
 *
 *   MONEY IS BASE CURRENCY. Every figure returned is in the base currency
 *   (USD), converted with the fx_rate captured on the purchase order at order
 *   time. Summing raw foreign amounts would produce a "total spend" that is
 *   the sum of euros and yen, which is not a number.
 *
 *   DATES ARE PLAIN DAYS. order_date, expected_arrival and actual_arrival are
 *   YYYY-MM-DD, compared as days rather than instants. A purchase order is
 *   placed on a day; introducing a time zone only ever produces off-by-one
 *   delays.
 * ------------------------------------------------------------------------ */

const MS_PER_DAY = 864e5;

/** Days from a to b, positive when b is later. Parsed as UTC midnight so the
 * result never shifts with the reader's time zone. */
export function daysBetween(a: string, b: string): number {
  const from = Date.parse(a + "T00:00:00Z");
  const to = Date.parse(b + "T00:00:00Z");
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / MS_PER_DAY);
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Statuses meaning the goods are physically in hand. */
const SETTLED: ReadonlySet<PoStatus> = new Set(["arrived", "received"]);
/** Statuses meaning the order is live but nothing has landed yet. */
const OPEN: ReadonlySet<PoStatus> = new Set([
  "draft", "approved", "sent", "confirmed", "in_production", "in_transit",
]);

export function isSettled(po: PurchaseOrder): boolean { return SETTLED.has(po.status); }
export function isOpen(po: PurchaseOrder): boolean { return OPEN.has(po.status); }
export function isCancelled(po: PurchaseOrder): boolean { return po.status === "cancelled"; }

/** Goods value, before tax, shipping and discount. Base currency. */
export function poSubtotal(po: PurchaseOrder): number {
  const lines = (po.items || []).reduce((a, i) => a + Number(i.qty) * Number(i.unit_price), 0);
  return lines * Number(po.fx_rate || 1);
}

/** Landed cost: what leaves the bank. Base currency.
 *
 * The brief defines Total Purchase Value as quantity x unit price; that is
 * poSubtotal above. This adds the header charges, and it is what every spend
 * KPI uses -- tax and freight are real money spent on procurement, and a
 * "total spend" that excludes them understates the budget it is measured
 * against. */
export function poTotal(po: PurchaseOrder): number {
  const rate = Number(po.fx_rate || 1);
  const extras = (Number(po.tax) + Number(po.shipping) - Number(po.discount)) * rate;
  return poSubtotal(po) + extras;
}

export function poQty(po: PurchaseOrder): number {
  return (po.items || []).reduce((a, i) => a + Number(i.qty), 0);
}

/** Days late, or 0 when on time. Positive only.
 *
 * Two cases, and the difference matters: an order that HAS arrived is judged
 * against the day it actually landed and its lateness is final. One that has
 * not is judged against today, so its delay grows every morning it stays
 * missing -- which is the behaviour that makes a late order impossible to
 * ignore. A cancelled order is never late; nobody is waiting for it. */
export function poDelayDays(po: PurchaseOrder, today: string): number {
  if (!po.expected_arrival || isCancelled(po)) return 0;
  const end = po.actual_arrival || today;
  return Math.max(0, daysBetween(po.expected_arrival, end));
}

export function isDelayed(po: PurchaseOrder, today: string): boolean {
  return poDelayDays(po, today) > 0;
}

/** Days until arrival is expected; negative once that date has passed.
 * null when no date was ever promised, which is different from zero. */
export function poDaysRemaining(po: PurchaseOrder, today: string): number | null {
  if (!po.expected_arrival) return null;
  return daysBetween(today, po.expected_arrival);
}

/** Order date to actual arrival. null while the goods are still outstanding
 * -- an unfinished journey has no duration yet, and counting it as zero would
 * flatter every supplier still holding your order. */
export function poLeadTime(po: PurchaseOrder): number | null {
  if (!po.actual_arrival) return null;
  return Math.max(0, daysBetween(po.order_date, po.actual_arrival));
}

/** Landed on or before the promised day. Only meaningful once arrived. */
export function arrivedOnTime(po: PurchaseOrder): boolean {
  if (!po.actual_arrival || !po.expected_arrival) return false;
  return daysBetween(po.expected_arrival, po.actual_arrival) <= 0;
}

export type DeliveryState = "received" | "on_time" | "in_transit" | "due_soon" | "delayed" | "cancelled" | "open";

/** The single colour a row gets. Ordered by precedence, not by workflow:
 * "delayed" beats "in transit" because a late shipment is still in transit
 * and the lateness is the part somebody has to act on. */
export function deliveryState(po: PurchaseOrder, today: string, dueSoonDays = 7): DeliveryState {
  if (isCancelled(po)) return "cancelled";
  if (isSettled(po)) return arrivedOnTime(po) || !po.expected_arrival ? "received" : "delayed";
  if (isDelayed(po, today)) return "delayed";
  if (po.status === "in_transit") return "in_transit";
  const left = poDaysRemaining(po, today);
  if (left != null && left <= dueSoonDays) return "due_soon";
  return "open";
}

/* -------------------------------------------------------------------------
 * Headline figures
 * ---------------------------------------------------------------------- */

export interface ProcurementKpis {
  totalValue: number;
  orderCount: number;
  totalQty: number;
  supplierCount: number;
  countryCount: number;
  pendingOrders: number;
  inTransitOrders: number;
  receivedOrders: number;
  delayedOrders: number;
  delayedValue: number;
  /** Mean order-to-arrival across delivered orders, in days. */
  avgDeliveryDays: number | null;
  /** 0..1 across delivered orders that had a promised date. */
  onTimeRate: number | null;
  /** Value of live orders whose goods have not landed. */
  outstandingValue: number;
  avgOrderValue: number;
}

export function computeKpis(
  pos: PurchaseOrder[], suppliers: Supplier[], today: string
): ProcurementKpis {
  // Cancelled orders are excluded from spend and counts throughout. They are
  // not purchases; leaving them in inflates every total and quietly flatters
  // the delivery statistics by adding orders that could never be late.
  const live = pos.filter((p) => !isCancelled(p));
  const settled = live.filter(isSettled);
  const open = live.filter(isOpen);
  const delayed = live.filter((p) => isDelayed(p, today));

  const byId = new Map(suppliers.map((s) => [s.id, s]));
  const usedSuppliers = new Set(live.map((p) => p.supplier_id));
  const countries = new Set(
    [...usedSuppliers].map((id) => byId.get(id)?.country_code).filter((c): c is string => !!c)
  );

  const leadTimes = settled.map(poLeadTime).filter((d): d is number => d != null);
  // Only orders that promised a date can be judged against one. Counting an
  // order with no expected date as "on time" would let a supplier improve its
  // score by refusing to commit to a date at all.
  const judgeable = settled.filter((p) => p.expected_arrival);
  const totalValue = live.reduce((a, p) => a + poTotal(p), 0);

  return {
    totalValue,
    orderCount: live.length,
    totalQty: live.reduce((a, p) => a + poQty(p), 0),
    supplierCount: usedSuppliers.size,
    countryCount: countries.size,
    pendingOrders: open.filter((p) => p.status !== "in_transit").length,
    inTransitOrders: live.filter((p) => p.status === "in_transit").length,
    receivedOrders: settled.length,
    delayedOrders: delayed.length,
    delayedValue: delayed.reduce((a, p) => a + poTotal(p), 0),
    avgDeliveryDays: leadTimes.length
      ? leadTimes.reduce((a, d) => a + d, 0) / leadTimes.length : null,
    onTimeRate: judgeable.length
      ? judgeable.filter(arrivedOnTime).length / judgeable.length : null,
    outstandingValue: open.reduce((a, p) => a + poTotal(p), 0),
    avgOrderValue: live.length ? totalValue / live.length : 0,
  };
}

/** (current - previous) / previous, or null when there is no previous period
 * to compare against. null rather than 0 or Infinity: "no basis for
 * comparison" is not "no change", and a dashboard that prints +Infinity% for
 * the first month of trading is worse than one that prints nothing. */
export function growth(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / previous;
}

/* -------------------------------------------------------------------------
 * Groupings
 * ---------------------------------------------------------------------- */

export interface PeriodSpend {
  /** YYYY-MM */
  month: string;
  value: number;
  qty: number;
  orders: number;
}

/** Spend by calendar month, gap-filled so a month with no purchasing appears
 * as a zero rather than vanishing and making the trend look continuous. */
export function spendByMonth(pos: PurchaseOrder[], from: string, to: string): PeriodSpend[] {
  const buckets = new Map<string, PeriodSpend>();
  const start = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  for (let d = new Date(start); d <= end; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const key = d.toISOString().slice(0, 7);
    buckets.set(key, { month: key, value: 0, qty: 0, orders: 0 });
  }
  for (const po of pos) {
    if (isCancelled(po)) continue;
    const key = po.order_date.slice(0, 7);
    const b = buckets.get(key);
    if (!b) continue;
    b.value += poTotal(po);
    b.qty += poQty(po);
    b.orders += 1;
  }
  return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/* ---------------------------------------------------------------------------
 * Landed cost.
 *
 * The purchase price of a line is not what the goods cost you. Tax, freight
 * and a supplier discount sit on the ORDER, not the line, and they are real
 * money spent to get these particular goods onto the shelf. Reporting margin
 * against the bare purchase price overstates profit by exactly the freight
 * bill -- quietly, and worse the further the goods travelled.
 *
 * Header costs are split across lines by VALUE, not by unit count. Shipping
 * a $2,000 machine and a $5 cable in one container: splitting per-unit would
 * load nearly the whole freight bill onto the cable and report it as sold at
 * a catastrophic loss. Value is the honest proxy when nothing tells us the
 * weight or volume each line actually took up.
 * ------------------------------------------------------------------------ */

export interface LandedCostLine {
  itemId: string;
  productId: string | null;
  qty: number;
  /** In the order's currency, before any share of header costs. */
  unitPrice: number;
  /** Purchase price plus this line's share of tax/shipping/discount,
   * converted to base currency. This is what reaches product_costs. */
  landedUnitCost: number;
  /** landedUnitCost x qty. */
  landedTotal: number;
}

/** Split an order's header costs across its lines and convert to base
 * currency. Returns one entry per line, in the order they were given. */
export function landedCosts(po: PurchaseOrder): LandedCostLine[] {
  const items = po.items || [];
  const subtotal = items.reduce((a, i) => a + Number(i.qty) * Number(i.unit_price), 0);

  // Discount reduces what you paid; tax and shipping increase it. A negative
  // total (a discount larger than tax + freight) is legitimate and lowers
  // every line's cost proportionally.
  const overhead = Number(po.tax || 0) + Number(po.shipping || 0) - Number(po.discount || 0);
  const fx = Number(po.fx_rate) || 1;

  return items.map((i) => {
    const qty = Number(i.qty) || 0;
    const unitPrice = Number(i.unit_price) || 0;
    const lineValue = qty * unitPrice;

    // An order of entirely free goods still has freight. With no value to
    // split by, fall back to an equal split per line so the cost is not
    // silently dropped.
    const share = subtotal > 0
      ? (lineValue / subtotal) * overhead
      : (items.length ? overhead / items.length : 0);

    // Never let a big discount drive a cost below zero: a negative cost
    // would report margin above 100% and corrupt every aggregate above it.
    const landedUnitCost = qty > 0
      ? Math.max(0, (unitPrice + share / qty) * fx)
      : 0;

    return {
      itemId: i.id,
      productId: i.product_id,
      qty,
      unitPrice,
      landedUnitCost,
      landedTotal: landedUnitCost * qty,
    };
  });
}

/** Split sizes as the buyer typed them on the purchase order into the array
 * a product stores: "S, M, L, XL" -> ["S","M","L","XL"].
 *
 * Accepts commas, slashes and newlines, because a buyer copying from a
 * supplier's invoice gets whichever that supplier used. Trims, drops blanks
 * and removes duplicates while keeping the order given -- size order is
 * meaningful (S before M before L) and sorting it would scramble that. */
export function parseSizes(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw || "").split(/[,/\n]+/)) {
    const size = part.trim();
    if (!size) continue;
    // Case-insensitive de-duplication, but the first spelling is what is
    // kept: "s, S" is one size, written the way it was first written.
    const key = size.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(size);
  }
  return out;
}

/** True when a line is goods bought to sell on, and so the only kind of line
 * that may ever touch stock or the catalog. An office chair is a real
 * purchase that must never appear in the shop. */
export function isResaleLine(item: PurchaseOrderItem): boolean {
  return item.category === "goods_for_resale";
}

export interface SupplierPerformance {
  supplier: Supplier;
  orders: number;
  value: number;
  qty: number;
  /** Value-weighted, so one cheap outlier line cannot swing it. */
  avgUnitPrice: number | null;
  avgDeliveryDays: number | null;
  onTimeRate: number | null;
  delayedOrders: number;
  pendingOrders: number;
  lastPurchase: string | null;
  nextArrival: string | null;
  /** Share of total spend, 0..1. */
  share: number;
  /** 0..100. See scoreSupplier. */
  score: number;
}

/** A single comparable number per supplier, so a manager can rank a book of
 * them without reading six columns.
 *
 * Weighted toward reliability rather than size, on purpose: a supplier being
 * large is a fact about your business, not a fact about how well they serve
 * it. Spend and frequency are in at all only because a perfectly reliable
 * supplier used once should not outrank a nearly-as-reliable one used weekly.
 *
 *   50  on-time delivery rate
 *   20  delay burden (share of their orders that ran late)
 *   15  speed, relative to a 60-day worst case
 *   10  order frequency, saturating at 12 orders
 *    5  spend share
 *
 * A supplier with nothing delivered yet scores on what is known and is
 * marked unrated by the caller rather than being given a misleading 50. */
export function scoreSupplier(p: Omit<SupplierPerformance, "score">): number {
  const onTime = p.onTimeRate ?? 0;
  const delayBurden = p.orders ? p.delayedOrders / p.orders : 0;
  const speed = p.avgDeliveryDays == null ? 0 : Math.max(0, 1 - p.avgDeliveryDays / 60);
  const frequency = Math.min(1, p.orders / 12);
  const share = Math.min(1, p.share * 4); // 25% of spend saturates this term

  return Math.round(
    onTime * 50 + (1 - delayBurden) * 20 + speed * 15 + frequency * 10 + share * 5
  );
}

export function supplierPerformance(
  pos: PurchaseOrder[], suppliers: Supplier[], today: string
): SupplierPerformance[] {
  const live = pos.filter((p) => !isCancelled(p));
  const totalValue = live.reduce((a, p) => a + poTotal(p), 0);
  const bySupplier = new Map<string, PurchaseOrder[]>();
  for (const po of live) {
    const arr = bySupplier.get(po.supplier_id) || [];
    arr.push(po);
    bySupplier.set(po.supplier_id, arr);
  }

  return suppliers.map((supplier) => {
    const mine = bySupplier.get(supplier.id) || [];
    const settled = mine.filter(isSettled);
    const judgeable = settled.filter((p) => p.expected_arrival);
    const leadTimes = settled.map(poLeadTime).filter((d): d is number => d != null);
    const value = mine.reduce((a, p) => a + poTotal(p), 0);
    const qty = mine.reduce((a, p) => a + poQty(p), 0);

    const upcoming = mine
      .filter((p) => isOpen(p) && p.expected_arrival)
      .map((p) => p.expected_arrival as string)
      .sort();

    const base = {
      supplier,
      orders: mine.length,
      value,
      qty,
      // Value over quantity, not the mean of the line prices: a hundred cheap
      // screws should not weigh the same as one expensive machine.
      avgUnitPrice: qty ? mine.reduce((a, p) => a + poSubtotal(p), 0) / qty : null,
      avgDeliveryDays: leadTimes.length
        ? leadTimes.reduce((a, d) => a + d, 0) / leadTimes.length : null,
      onTimeRate: judgeable.length
        ? judgeable.filter(arrivedOnTime).length / judgeable.length : null,
      delayedOrders: mine.filter((p) => isDelayed(p, today)).length,
      pendingOrders: mine.filter(isOpen).length,
      lastPurchase: mine.length
        ? mine.map((p) => p.order_date).sort().slice(-1)[0] : null,
      nextArrival: upcoming[0] || null,
      share: totalValue ? value / totalValue : 0,
    };

    return { ...base, score: scoreSupplier(base) };
  }).sort((a, b) => b.value - a.value);
}

export interface GroupSpend {
  key: string;
  label: string;
  value: number;
  qty: number;
  orders: number;
  share: number;
  avgDeliveryDays: number | null;
  onTimeRate: number | null;
  suppliers: number;
}

function groupSpend(
  pos: PurchaseOrder[],
  keyOf: (po: PurchaseOrder) => { key: string; label: string } | null
): GroupSpend[] {
  const live = pos.filter((p) => !isCancelled(p));
  const total = live.reduce((a, p) => a + poTotal(p), 0);
  const groups = new Map<string, { label: string; pos: PurchaseOrder[] }>();

  for (const po of live) {
    const k = keyOf(po);
    if (!k) continue;
    const g = groups.get(k.key) || { label: k.label, pos: [] };
    g.pos.push(po);
    groups.set(k.key, g);
  }

  return [...groups.entries()].map(([key, g]) => {
    const settled = g.pos.filter(isSettled);
    const judgeable = settled.filter((p) => p.expected_arrival);
    const leadTimes = settled.map(poLeadTime).filter((d): d is number => d != null);
    const value = g.pos.reduce((a, p) => a + poTotal(p), 0);
    return {
      key,
      label: g.label,
      value,
      qty: g.pos.reduce((a, p) => a + poQty(p), 0),
      orders: g.pos.length,
      share: total ? value / total : 0,
      avgDeliveryDays: leadTimes.length
        ? leadTimes.reduce((a, d) => a + d, 0) / leadTimes.length : null,
      onTimeRate: judgeable.length
        ? judgeable.filter(arrivedOnTime).length / judgeable.length : null,
      suppliers: new Set(g.pos.map((p) => p.supplier_id)).size,
    };
  }).sort((a, b) => b.value - a.value);
}

export function spendByCountry(
  pos: PurchaseOrder[], suppliers: Supplier[],
  countryName: (code: string) => string
): GroupSpend[] {
  const byId = new Map(suppliers.map((s) => [s.id, s]));
  return groupSpend(pos, (po) => {
    const code = byId.get(po.supplier_id)?.country_code || "";
    return { key: code || "??", label: code ? countryName(code) : "Unknown" };
  });
}

export function spendBySupplier(
  pos: PurchaseOrder[], suppliers: Supplier[]
): GroupSpend[] {
  const byId = new Map(suppliers.map((s) => [s.id, s]));
  return groupSpend(pos, (po) => ({
    key: po.supplier_id,
    label: byId.get(po.supplier_id)?.name || "Unknown supplier",
  }));
}

export interface CategorySpend {
  category: PoCategory;
  value: number;
  qty: number;
  orders: number;
  share: number;
}

/** Category lives on the LINE, not the order, so a purchase order mixing
 * packaging and components splits across both rather than being filed
 * whole under whichever line happened to come first. */
export function spendByCategory(pos: PurchaseOrder[]): CategorySpend[] {
  const live = pos.filter((p) => !isCancelled(p));
  const acc = new Map<PoCategory, { value: number; qty: number; orders: Set<string> }>();

  for (const po of live) {
    const rate = Number(po.fx_rate || 1);
    for (const item of po.items || []) {
      const cur = acc.get(item.category) || { value: 0, qty: 0, orders: new Set<string>() };
      cur.value += Number(item.qty) * Number(item.unit_price) * rate;
      cur.qty += Number(item.qty);
      cur.orders.add(po.id);
      acc.set(item.category, cur);
    }
  }

  const total = [...acc.values()].reduce((a, c) => a + c.value, 0);
  return [...acc.entries()]
    .map(([category, c]) => ({
      category, value: c.value, qty: c.qty, orders: c.orders.size,
      share: total ? c.value / total : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

export interface ProductSpend {
  name: string;
  category: PoCategory;
  qty: number;
  value: number;
  avgUnitPrice: number;
  orders: number;
  mainSupplier: string;
  lastPurchase: string | null;
}

export function spendByProduct(pos: PurchaseOrder[], suppliers: Supplier[]): ProductSpend[] {
  const byId = new Map(suppliers.map((s) => [s.id, s]));
  const acc = new Map<string, {
    name: string; category: PoCategory; qty: number; value: number;
    orders: Set<string>; bySupplier: Map<string, number>; last: string | null;
  }>();

  for (const po of pos) {
    if (isCancelled(po)) continue;
    const rate = Number(po.fx_rate || 1);
    for (const item of po.items || []) {
      // Keyed on the trimmed, case-folded name: the same thing typed with a
      // stray capital is the same thing, and splitting it in two hides how
      // much is really being bought.
      const key = item.product_name.trim().toLowerCase();
      if (!key) continue;
      const cur = acc.get(key) || {
        name: item.product_name.trim(), category: item.category, qty: 0, value: 0,
        orders: new Set<string>(), bySupplier: new Map<string, number>(), last: null,
      };
      const lineValue = Number(item.qty) * Number(item.unit_price) * rate;
      cur.qty += Number(item.qty);
      cur.value += lineValue;
      cur.orders.add(po.id);
      cur.bySupplier.set(po.supplier_id, (cur.bySupplier.get(po.supplier_id) || 0) + lineValue);
      if (!cur.last || po.order_date > cur.last) cur.last = po.order_date;
      acc.set(key, cur);
    }
  }

  return [...acc.values()].map((c) => {
    const main = [...c.bySupplier.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      name: c.name,
      category: c.category,
      qty: c.qty,
      value: c.value,
      avgUnitPrice: c.qty ? c.value / c.qty : 0,
      orders: c.orders.size,
      mainSupplier: main ? (byId.get(main[0])?.name || "") : "",
      lastPurchase: c.last,
    };
  }).sort((a, b) => b.value - a.value);
}

export interface StatusBucket { status: PoStatus; count: number; value: number }

export const PO_STATUSES: readonly PoStatus[] = [
  "draft", "approved", "sent", "confirmed",
  "in_production", "in_transit", "arrived", "received", "cancelled",
];

export function statusBreakdown(pos: PurchaseOrder[]): StatusBucket[] {
  return PO_STATUSES.map((status) => {
    const mine = pos.filter((p) => p.status === status);
    return { status, count: mine.length, value: mine.reduce((a, p) => a + poTotal(p), 0) };
  });
}

/* -------------------------------------------------------------------------
 * Alerts
 * ---------------------------------------------------------------------- */

export type AlertKind =
  | "delayed" | "arriving_soon" | "supplier_underperforming"
  | "payment_overdue" | "unconfirmed" | "unusually_large";

export interface ProcurementAlert {
  kind: AlertKind;
  severity: "high" | "medium";
  /** Purchase orders this alert is about, so clicking through has somewhere
   * to go. */
  poIds: string[];
  /** Values the UI substitutes into its own translated wording -- so an
   * alert never carries an English sentence into a Tetun interface. */
  count: number;
  value?: number;
  label?: string;
}

export interface AlertOptions {
  arrivingWithinDays?: number;
  /** On-time rate below which a supplier is flagged, 0..1. */
  onTimeTarget?: number;
  /** A supplier is only judged once it has this many delivered orders --
   * one late delivery out of one should not brand a new supplier unreliable. */
  minOrdersToJudge?: number;
  /** Multiple of the average order value that counts as unusually large. */
  largeOrderFactor?: number;
}

export function buildAlerts(
  pos: PurchaseOrder[], suppliers: Supplier[], today: string, opts: AlertOptions = {}
): ProcurementAlert[] {
  const arrivingWithinDays = opts.arrivingWithinDays ?? 3;
  const onTimeTarget = opts.onTimeTarget ?? 0.8;
  const minOrdersToJudge = opts.minOrdersToJudge ?? 3;
  const largeOrderFactor = opts.largeOrderFactor ?? 3;

  const live = pos.filter((p) => !isCancelled(p));
  const out: ProcurementAlert[] = [];

  const delayed = live.filter((p) => isDelayed(p, today));
  if (delayed.length) {
    out.push({
      kind: "delayed", severity: "high",
      poIds: delayed.map((p) => p.id), count: delayed.length,
      value: delayed.reduce((a, p) => a + poTotal(p), 0),
    });
  }

  const soon = live.filter((p) => {
    if (!isOpen(p)) return false;
    const left = poDaysRemaining(p, today);
    return left != null && left >= 0 && left <= arrivingWithinDays;
  });
  if (soon.length) {
    out.push({
      kind: "arriving_soon", severity: "medium",
      poIds: soon.map((p) => p.id), count: soon.length,
      value: soon.reduce((a, p) => a + poTotal(p), 0),
    });
  }

  const overdue = live.filter((p) => p.payment_status === "overdue");
  if (overdue.length) {
    out.push({
      kind: "payment_overdue", severity: "high",
      poIds: overdue.map((p) => p.id), count: overdue.length,
      value: overdue.reduce((a, p) => a + poTotal(p), 0),
    });
  }

  // Sent to the supplier and still not acknowledged. `sent` specifically, not
  // any open status: a draft has not been sent to anyone, so nobody is
  // failing to confirm it.
  const unconfirmed = live.filter((p) => p.status === "sent");
  if (unconfirmed.length) {
    out.push({
      kind: "unconfirmed", severity: "medium",
      poIds: unconfirmed.map((p) => p.id), count: unconfirmed.length,
    });
  }

  for (const perf of supplierPerformance(pos, suppliers, today)) {
    const delivered = perf.orders - perf.pendingOrders;
    if (perf.onTimeRate == null || delivered < minOrdersToJudge) continue;
    if (perf.onTimeRate >= onTimeTarget) continue;
    out.push({
      kind: "supplier_underperforming", severity: "medium",
      poIds: live.filter((p) => p.supplier_id === perf.supplier.id).map((p) => p.id),
      count: 1, label: perf.supplier.name, value: perf.onTimeRate,
    });
  }

  // "Unusually large" is relative to this book of orders, not an absolute
  // threshold: what counts as a big purchase differs by orders of magnitude
  // between companies, and a fixed number would be wrong for all of them.
  if (live.length >= 5) {
    const avg = live.reduce((a, p) => a + poTotal(p), 0) / live.length;
    const large = live.filter((p) => poTotal(p) > avg * largeOrderFactor);
    if (large.length) {
      out.push({
        kind: "unusually_large", severity: "medium",
        poIds: large.map((p) => p.id), count: large.length,
        value: large.reduce((a, p) => a + poTotal(p), 0),
      });
    }
  }

  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
}

/* -------------------------------------------------------------------------
 * Filtering
 * ---------------------------------------------------------------------- */

export interface ProcurementFilter {
  from?: string;
  to?: string;
  supplierId?: string;
  countryCode?: string;
  category?: PoCategory | "";
  status?: PoStatus | "";
  paymentStatus?: PoPaymentStatus | "";
  buyer?: string;
  currency?: string;
  /** Matches PO number, supplier name, buyer or any line's product name. */
  q?: string;
}

export function filterPurchaseOrders(
  pos: PurchaseOrder[], suppliers: Supplier[], f: ProcurementFilter
): PurchaseOrder[] {
  const byId = new Map(suppliers.map((s) => [s.id, s]));
  const q = (f.q || "").trim().toLowerCase();

  return pos.filter((po) => {
    if (f.from && po.order_date < f.from) return false;
    if (f.to && po.order_date > f.to) return false;
    if (f.supplierId && po.supplier_id !== f.supplierId) return false;
    if (f.status && po.status !== f.status) return false;
    if (f.paymentStatus && po.payment_status !== f.paymentStatus) return false;
    if (f.currency && po.currency !== f.currency) return false;
    if (f.buyer && po.buyer !== f.buyer) return false;
    if (f.countryCode && (byId.get(po.supplier_id)?.country_code || "") !== f.countryCode) return false;
    if (f.category && !(po.items || []).some((i) => i.category === f.category)) return false;
    if (q) {
      const hay = [
        po.po_number, po.buyer, byId.get(po.supplier_id)?.name || "",
        ...(po.items || []).map((i) => i.product_name),
      ].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
