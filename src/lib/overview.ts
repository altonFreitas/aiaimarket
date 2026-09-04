import { isLive, totals, type SalesLine } from "./sales";
import { isCancelled, isResaleLine, poTotal } from "./procurement";
import { storeDay, storeDayStart, storeHourKey } from "./tz";
import type { PurchaseOrder } from "./types";

/* The two halves of the business on one timeline.
 *
 * WHAT THIS IS FOR, AND WHY IT IS NOT ON EITHER DASHBOARD ALREADY.
 *
 * /admin/sales answers everything about selling and nothing about buying.
 * /admin/procurement answers everything about buying and nothing about
 * selling. Neither can answer the question a person running the business
 * actually opens with -- "is what we take in growing faster than what we
 * spend?" -- because each sees half the picture.
 *
 * So this module computes ONLY the comparison. It does not recompute the
 * breakdowns: sales by category, supplier performance, top customers, the
 * order backlog and the rest stay on the screens that already do them
 * properly, and Home links out to them. Two screens saying the same thing
 * in different words is the problem the Statistics page was deleted for.
 *
 * THREE DECISIONS THAT CHANGE THE NUMBERS, EACH MADE ON PURPOSE.
 *
 * 1. MONEY IN uses net sales; MONEY OUT uses landed cost. poTotal()
 *    includes tax and freight, because that is what actually leaves the
 *    bank, and a "total spend" that excludes them understates the thing it
 *    is being compared against.
 *
 * 2. UNITS PURCHASED COUNTS GOODS FOR RESALE ONLY. poQty() sums every line
 *    on an order -- packaging, an office chair, a service. Comparing units
 *    sold against that is not a stock-movement chart, it is nonsense with a
 *    line through it. isResaleLine() is the existing rule for "goods that
 *    may ever touch stock", and it is the right rule here.
 *
 * 3. GROSS PROFIT IS NOT REVENUE MINUS PURCHASES. It is revenue minus the
 *    cost of the goods that were SOLD, which the sales lines already carry.
 *    Purchases in a period are stock bought, most of which is still on the
 *    shelf; subtracting them from revenue produces a number that swings
 *    wildly with the timing of orders and means nothing. The two are shown
 *    side by side, and their relationship is reported as a RATIO, which is
 *    what it honestly is.
 *
 * Pure: sales lines and purchase orders in, rows out. Every figure on the
 * Home dashboard can therefore be tested without a database.
 */

/* ---------------------------------------------------------------------------
 * One period of both sides
 * ------------------------------------------------------------------------ */

/* ---------------------------------------------------------------------------
 * Ranges, the way a price chart does them
 *
 * The window and the bucket move together: a day is read in hours, five
 * days in days, half a year in weeks, longer in months. Choosing the bucket
 * from the window rather than offering it as a second control is what stops
 * anybody asking for five years by the hour -- 43,800 points behind a line
 * eight hundred pixels wide.
 * ------------------------------------------------------------------------ */

export type RangeKey = "1d" | "5d" | "1m" | "6m" | "ytd" | "1y" | "5y" | "max";
export type Bucket = "hour" | "day" | "week" | "month";

export interface RangeSpec {
  key: RangeKey;
  bucket: Bucket;
  /** Days back from today. Absent for the two that are not a fixed length. */
  days?: number;
}

export const RANGES: readonly RangeSpec[] = [
  { key: "1d", bucket: "hour", days: 1 },
  { key: "5d", bucket: "day", days: 5 },
  { key: "1m", bucket: "day", days: 30 },
  { key: "6m", bucket: "week", days: 182 },
  { key: "ytd", bucket: "month" },
  { key: "1y", bucket: "month", days: 365 },
  { key: "5y", bucket: "month", days: 1826 },
  { key: "max", bucket: "month" },
];

export function rangeSpec(key: RangeKey): RangeSpec {
  return RANGES.find((r) => r.key === key) ?? RANGES[2];
}

/* WHY THE PURCHASE LINE DISAPPEARS ON 1D, AND MUST.
 *
 * purchase_orders.order_date is a DATE. There is no time of day on a
 * purchase order and there never has been. Bucketed by hour, every order
 * ever placed lands at midnight -- so an intraday chart would draw a single
 * spike at 00:00 and a flat line across the rest of the day, and somebody
 * would read that as "we buy at midnight". It is not a gap in the data to
 * be interpolated over; the information does not exist.
 *
 * So the hour bucket carries sales only, and the screen says why. */
export function purchasesResolvable(bucket: Bucket): boolean {
  return bucket !== "hour";
}

export interface PeriodPoint {
  /** Sort key: "2026-09-04T14", "2026-09-04", "2026-09". */
  key: string;
  /** Short, for the axis: "14:00", "04/09", "09/26". */
  label: string;
  /** Full, for the tooltip: "2026-09-04 14:00". */
  full: string;
  revenue: number;
  qtySold: number;
  /** Landed cost of purchase orders dated in this period. */
  purchaseCost: number;
  /** Units of goods-for-resale only. See decision 2 above. */
  qtyPurchased: number;
}

/** Units on an order that are goods for resale. */
export function resaleQty(po: PurchaseOrder): number {
  return (po.items || [])
    .filter(isResaleLine)
    .reduce((a, i) => a + (Number(i.qty) || 0), 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const DAY_MS = 86_400_000;

/** The Monday-start week a store day belongs to, as that Monday's day. */
export function weekStart(day: string): string {
  const ms = storeDayStart(day);
  if (!Number.isFinite(ms)) return day;
  // getUTCDay on the day's own midnight: the store day string is what is
  // being bucketed, so its weekday is read from the same calendar.
  const dow = new Date(day + "T00:00:00Z").getUTCDay();
  const backTo = (dow + 6) % 7; // Sunday(0) -> 6 days back, Monday(1) -> 0
  return storeDay(ms - backTo * DAY_MS);
}

/** The bucket key a store day (or hour key) belongs to. */
export function bucketKey(bucket: Bucket, dayOrHour: string): string {
  switch (bucket) {
    case "hour": return dayOrHour.slice(0, 13);
    case "day": return dayOrHour.slice(0, 10);
    case "week": return weekStart(dayOrHour.slice(0, 10));
    case "month": return dayOrHour.slice(0, 7);
  }
}

/** Short axis label, and the fuller one for a tooltip. */
export function bucketLabels(bucket: Bucket, key: string): { label: string; full: string } {
  switch (bucket) {
    case "hour":
      return { label: `${key.slice(11, 13)}:00`, full: `${key.slice(0, 10)} ${key.slice(11, 13)}:00` };
    case "day":
      return { label: `${key.slice(8, 10)}/${key.slice(5, 7)}`, full: key };
    case "week":
      return { label: `${key.slice(8, 10)}/${key.slice(5, 7)}`, full: key };
    case "month":
      return { label: `${key.slice(5, 7)}/${key.slice(2, 4)}`, full: key };
  }
}

/** Every bucket in the window, in order and gap-filled.
 *
 * Gaps stay as zeroes: an hour with no sales is the interesting hour, and
 * closing it would run the line straight through as though trade had been
 * continuous. */
function bucketsFor(
  spec: RangeSpec, earliest: string | null, today: string
): string[] {
  const out: string[] = [];

  if (spec.bucket === "hour") {
    /* TODAY, 00:00 to 23:00 -- not a rolling twenty-four hours.
     *
     * A rolling window crosses midnight, so "1D" would cover part of
     * yesterday and the headline figure beside it could not be "today's
     * takings" without disagreeing with its own chart. A shop asks "how
     * are we doing today", and today is a calendar day. */
    for (let h = 0; h < 24; h++) out.push(`${today}T${String(h).padStart(2, "0")}`);
    return out;
  }

  // Where the window starts.
  let from: string;
  if (spec.key === "ytd") from = `${today.slice(0, 4)}-01-01`;
  else if (spec.key === "max") from = earliest ?? today;
  else from = storeDay(storeDayStart(today) - (spec.days! - 1) * DAY_MS);
  /* Clamping to when the business began is right for the LONG ranges: a
   * shop three months old asking for five years should not be shown
   * fifty-seven empty months before it existed. It is wrong for the short
   * ones -- on a five-day view, the two days nothing sold are the point,
   * and dropping them would make three days of trading look like five. So
   * the month buckets clamp and the finer ones do not. */
  if (earliest && spec.bucket === "month" && spec.key !== "ytd" && from < earliest) {
    from = earliest;
  }

  if (spec.bucket === "day") {
    for (let d = from; d <= today; d = storeDay(storeDayStart(d) + DAY_MS)) {
      out.push(d);
      if (out.length > 400) break;
    }
    return out;
  }

  if (spec.bucket === "week") {
    for (let d = weekStart(from); d <= today; d = storeDay(storeDayStart(d) + 7 * DAY_MS)) {
      out.push(d);
      if (out.length > 300) break;
    }
    return out;
  }

  // Months.
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ly, lm] = today.slice(0, 7).split("-").map(Number);
  for (let guard = 0; guard < 600; guard++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (y === ly && m === lm) break;
    if (y > ly || (y === ly && m > lm)) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** The earliest store day either side has any activity on. */
export function earliestActivity(
  lines: readonly SalesLine[], pos: readonly PurchaseOrder[]
): string | null {
  let earliest: string | null = null;
  const take = (d: string | undefined | null) => {
    if (!d) return;
    const day = d.slice(0, 10);
    if (!earliest || day < earliest) earliest = day;
  };
  for (const l of lines) take(l.date);
  for (const p of pos) take(p.order_date);
  return earliest;
}

/** Both sides over one range, bucketed to match it. */
export function overviewSeries(
  lines: readonly SalesLine[], pos: readonly PurchaseOrder[],
  range: RangeKey, today: string
): PeriodPoint[] {
  const spec = rangeSpec(range);
  const keys = bucketsFor(spec, earliestActivity(lines, pos), today);
  const index = new Map<string, PeriodPoint>();
  for (const k of keys) {
    const { label, full } = bucketLabels(spec.bucket, k);
    index.set(k, { key: k, label, full, revenue: 0, qtySold: 0, purchaseCost: 0, qtyPurchased: 0 });
  }

  for (const l of lines) {
    if (!isLive(l)) continue;
    // Hour buckets read the timestamp; everything coarser reads the store
    // day the sales line already carries.
    const from = spec.bucket === "hour" ? storeHourKey(Date.parse(l.createdAt)) : l.date;
    const p = index.get(bucketKey(spec.bucket, from));
    if (!p) continue;
    p.revenue += l.netSales;
    p.qtySold += l.qty;
  }

  if (purchasesResolvable(spec.bucket)) {
    for (const po of pos) {
      if (isCancelled(po)) continue;
      const p = index.get(bucketKey(spec.bucket, po.order_date));
      if (!p) continue;
      p.purchaseCost += poTotal(po);
      p.qtyPurchased += resaleQty(po);
    }
  }

  return keys.map((k) => {
    const p = index.get(k)!;
    return { ...p, revenue: round2(p.revenue), purchaseCost: round2(p.purchaseCost) };
  });
}

/* ---------------------------------------------------------------------------
 * Comparisons
 * ------------------------------------------------------------------------ */

export interface Comparison {
  current: number;
  previous: number;
  /** current - previous. */
  diff: number;
  /** (current - previous) / previous, or null with nothing to compare to.
   *
   * null rather than 0 or Infinity: "no basis for comparison" is not "no
   * change", and a dashboard printing +Infinity% in its first month of
   * trading is worse than one printing nothing. */
  pct: number | null;
}

export function compare(current: number, previous: number): Comparison {
  return {
    current: round2(current),
    previous: round2(previous),
    diff: round2(current - previous),
    pct: previous ? (current - previous) / previous : null,
  };
}

/* ---------------------------------------------------------------------------
 * The headline figures, over whatever range is on screen
 *
 * THE FIGURE AND THE CHART BENEATH IT MUST COVER THE SAME GROUND. They did
 * not: the cards always reported the current calendar month while the
 * chart showed whatever range was picked, so "total sales revenue" sat
 * above a chart of the last five days saying something else entirely, and
 * neither matched the orders screen. One window now feeds both.
 *
 * IT ALSO RETIRES A WHOLE CLASS OF BUG. Comparing part of a month against
 * a whole one reports a healthy business as collapsing, so the old version
 * carried careful machinery to compare the 1st-to-4th against the
 * 1st-to-4th. A range is a fixed number of days by construction, and the
 * period before it is the same number of days, so like-for-like is no
 * longer something to arrange -- it is what a range IS.
 * ------------------------------------------------------------------------ */

export interface WindowSpec {
  from: string;
  to: string;
  /** Inclusive length in days, so the period before it is the same size. */
  days: number;
}

const DAY = 86_400_000;

function daysApart(from: string, to: string): number {
  const a = storeDayStart(from);
  const b = storeDayStart(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.max(1, Math.round((b - a) / DAY) + 1);
}

/** The date span a range covers, as whole store days.
 *
 * Derived from the same bucket list the chart draws, so the two cannot
 * describe different periods -- which is the bug this replaced. */
export function rangeWindow(
  lines: readonly SalesLine[], pos: readonly PurchaseOrder[],
  range: RangeKey, today: string
): WindowSpec {
  const points = overviewSeries(lines, pos, range, today);
  if (!points.length) return { from: today, to: today, days: 1 };
  const from = points[0].key.slice(0, 10).length === 10 && points[0].key.includes("T")
    ? points[0].key.slice(0, 10)
    : expandKey(points[0].key, "start");
  const to = points[points.length - 1].key.includes("T")
    ? points[points.length - 1].key.slice(0, 10)
    : expandKey(points[points.length - 1].key, "end", today);
  return { from, to, days: daysApart(from, to) };
}

/** A bucket key back to a real date. A month key is the whole month, and
 * the last bucket never runs past today -- a range ending mid-month must
 * not claim the rest of it. */
function expandKey(key: string, edge: "start" | "end", today?: string): string {
  if (key.length === 7) {
    if (edge === "start") return `${key}-01`;
    const [y, m] = key.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const full = `${key}-${String(last).padStart(2, "0")}`;
    return today && full > today ? today : full;
  }
  return key;
}

/** Shifts a window back by n days, keeping its length. */
export function shiftWindow(w: WindowSpec, days: number): WindowSpec {
  const from = storeDay(storeDayStart(w.from) - days * DAY);
  const to = storeDay(storeDayStart(w.to) - days * DAY);
  return { from, to, days: w.days };
}

/** The same window a year earlier. Shifted by whole days rather than by a
 * calendar year so the two spans are the same length even across a leap
 * year -- 366 days against 365 would flatter or punish by a day's trade. */
export function lastYearWindow(w: WindowSpec): WindowSpec {
  return shiftWindow(w, 365);
}

export interface Totals {
  revenue: number;
  qtySold: number;
  purchaseCost: number;
  qtyPurchased: number;
  /** Revenue minus the cost of the goods SOLD -- not minus purchases. Null
   * when no sold line carried a cost. */
  grossProfit: number | null;
}

/** Both sides over one date window, inclusive. */
export function totalsIn(
  lines: readonly SalesLine[], pos: readonly PurchaseOrder[], w: { from: string; to: string }
): Totals {
  const inWindow = lines.filter((l) => l.date >= w.from && l.date <= w.to);
  const sold = totals(inWindow.filter(isLive));
  const bought = pos.filter(
    (p) => !isCancelled(p) && p.order_date >= w.from && p.order_date <= w.to);

  return {
    revenue: round2(sold.revenue),
    qtySold: sold.qty,
    purchaseCost: round2(bought.reduce((a, p) => a + poTotal(p), 0)),
    qtyPurchased: bought.reduce((a, p) => a + resaleQty(p), 0),
    grossProfit: sold.grossProfit == null ? null : round2(sold.grossProfit),
  };
}

export type MetricKey =
  | "revenue" | "purchaseCost" | "qtySold" | "qtyPurchased"
  | "grossProfit" | "ratio";

export interface MetricRow {
  key: MetricKey;
  current: number | null;
  /** Against the period of the same length immediately before this one. */
  prev: Comparison | null;
  /** Against the same span a year earlier. */
  yoy: Comparison | null;
}

/** Sales over purchases. Above 1 means more came in than went out on stock
 * in the period; it is a trading ratio, not a margin. Null when nothing was
 * bought, because dividing by zero is not "infinitely good". */
export function salesToPurchaseRatio(t: Totals): number | null {
  return t.purchaseCost ? t.revenue / t.purchaseCost : null;
}

function metricValue(t: Totals, key: MetricKey): number | null {
  switch (key) {
    case "revenue": return t.revenue;
    case "purchaseCost": return t.purchaseCost;
    case "qtySold": return t.qtySold;
    case "qtyPurchased": return t.qtyPurchased;
    case "grossProfit": return t.grossProfit;
    case "ratio": return salesToPurchaseRatio(t);
  }
}

export const METRIC_KEYS: readonly MetricKey[] = [
  "revenue", "purchaseCost", "qtySold", "qtyPurchased", "grossProfit", "ratio",
];

/** The six headline numbers for a range, each against the period before it
 * and against the same span last year. */
export function headlineMetrics(
  lines: readonly SalesLine[], pos: readonly PurchaseOrder[],
  range: RangeKey, today: string
): MetricRow[] {
  const w = rangeWindow(lines, pos, range, today);
  const now = totalsIn(lines, pos, w);
  const before = totalsIn(lines, pos, shiftWindow(w, w.days));
  const year = totalsIn(lines, pos, lastYearWindow(w));

  return METRIC_KEYS.map((key) => {
    const current = metricValue(now, key);
    const p = metricValue(before, key);
    const y = metricValue(year, key);
    return {
      key,
      current,
      prev: current == null || p == null ? null : compare(current, p),
      yoy: current == null || y == null ? null : compare(current, y),
    };
  });
}

/* ---------------------------------------------------------------------------
 * The written summary
 * ------------------------------------------------------------------------ */

export type InsightKind =
  | "revenue_up" | "revenue_down"
  | "spend_up" | "spend_down"
  | "growing_well" | "spending_faster"
  | "buying_more_selling_less"
  | "month_better" | "month_worse"
  | "top_customer" | "top_supplier";

export interface Insight {
  kind: InsightKind;
  /** Substituted into the sentence. */
  vars: Record<string, string>;
  tone: "good" | "bad" | "neutral";
}

const PCT = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

export interface InsightInput {
  metrics: readonly MetricRow[];
  topCustomer?: { label: string; value: number } | null;
  topSupplier?: { label: string; value: number } | null;
  money: (n: number) => string;
}

/** Short sentences a person can act on, in the order they matter.
 *
 * Deliberately few. A summary of eleven bullet points is a second dashboard
 * in prose, and nobody reads the eleventh. Each one is only emitted when it
 * is actually true of the data. */
export function buildOverviewInsights(input: InsightInput): Insight[] {
  const by = (k: MetricKey) => input.metrics.find((m) => m.key === k);
  const out: Insight[] = [];

  const revenue = by("revenue");
  const spend = by("purchaseCost");
  const qtySold = by("qtySold");
  const qtyBought = by("qtyPurchased");

  // Year on year first: it is the comparison that survives a seasonal
  // business, and the one a month-over-month figure can contradict.
  if (revenue?.yoy?.pct != null) {
    out.push({
      kind: revenue.yoy.pct >= 0 ? "revenue_up" : "revenue_down",
      vars: { pct: PCT(revenue.yoy.pct) },
      tone: revenue.yoy.pct >= 0 ? "good" : "bad",
    });
  }
  if (spend?.yoy?.pct != null) {
    out.push({
      kind: spend.yoy.pct >= 0 ? "spend_up" : "spend_down",
      vars: { pct: PCT(spend.yoy.pct) },
      // Spending more is not automatically bad -- a growing shop buys more.
      // Whether it is bad is the next line's job.
      tone: "neutral",
    });
  }

  // The line the whole screen exists for.
  if (revenue?.yoy?.pct != null && spend?.yoy?.pct != null) {
    const faster = revenue.yoy.pct >= spend.yoy.pct;
    out.push({
      kind: faster ? "growing_well" : "spending_faster",
      vars: { sales: PCT(revenue.yoy.pct), spend: PCT(spend.yoy.pct) },
      tone: faster ? "good" : "bad",
    });
  }

  // Units, which can move the other way from money when prices change.
  if (qtySold?.yoy?.pct != null && qtyBought?.yoy?.pct != null
      && qtyBought.yoy.pct > 0 && qtySold.yoy.pct < 0) {
    out.push({
      kind: "buying_more_selling_less",
      vars: { bought: PCT(qtyBought.yoy.pct), sold: PCT(qtySold.yoy.pct) },
      tone: "bad",
    });
  }

  // Against the period before this one, whatever length the reader chose.
  if (revenue?.prev?.pct != null) {
    out.push({
      kind: revenue.prev.pct >= 0 ? "month_better" : "month_worse",
      vars: { pct: PCT(revenue.prev.pct) },
      tone: revenue.prev.pct >= 0 ? "good" : "bad",
    });
  }

  if (input.topCustomer) {
    out.push({
      kind: "top_customer",
      vars: { name: input.topCustomer.label, value: input.money(input.topCustomer.value) },
      tone: "neutral",
    });
  }
  if (input.topSupplier) {
    out.push({
      kind: "top_supplier",
      vars: { name: input.topSupplier.label, value: input.money(input.topSupplier.value) },
      tone: "neutral",
    });
  }

  return out;
}
