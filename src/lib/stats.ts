import type { Order, Product } from "@/lib/types";

export interface DailyPoint { date: string; revenue: number; orders: number; qty: number; subtotal: number; fee: number }

export interface AdminStats {
  // headline KPIs
  totalRevenue: number;         // completed orders only — real, collected sales
  pendingRevenue: number;       // everything not yet completed/cancelled
  totalOrders: number;
  completedOrders: number;
  avgOrderValue: number;        // completed orders total / count
  cancellationRate: number;     // 0..1
  ordersLast7Days: number;
  revenueLast7Days: number;

  // breakdowns
  byStatus: Array<{ status: string; count: number }>;
  byPayMethod: Array<{ method: string; count: number }>;
  byPayStatus: Array<{ status: string; count: number }>;
  byZone: Array<{ zone: string; count: number }>;

  // catalog health
  liveProducts: number;
  outOfStock: number;
  lowStock: number;
  totalViews: number;
  totalWaClicks: number;
  clickThroughRate: number;     // wa_clicks / views, 0..1

  // top movers
  topProducts: Array<{ name: string; qty: number; revenue: number }>;

  // trends
  dailyLast14: DailyPoint[];
  monthlyLast12: PeriodPoint[];
  quarterlyLast8: PeriodPoint[];
  yearly: PeriodPoint[];
  drillData: DrillData;
}

export interface PeriodPoint { label: string; revenue: number; orders: number; qty: number; subtotal: number; fee: number }

const ORDER_STATUSES = ["new", "confirmed", "preparing", "out", "arrived", "completed", "cancelled"];
const PAY_METHODS = ["cod", "cop", "bank", "wallet", "fiar"];
const PAY_STATUSES = ["unpaid", "deposit", "paid", "refunded"];
const ZONES = ["dili_center", "dili_outskirts", "other_municipality"];

export function computeAdminStats(orders: Order[], products: Product[]): AdminStats {
  const completed = orders.filter((o) => o.status === "completed");
  const cancelled = orders.filter((o) => o.status === "cancelled");
  const pending = orders.filter((o) => !["completed", "cancelled"].includes(o.status));

  const totalRevenue = sum(completed, (o) => o.total);
  const pendingRevenue = sum(pending, (o) => o.total);
  const avgOrderValue = completed.length ? totalRevenue / completed.length : 0;
  const cancellationRate = orders.length ? cancelled.length / orders.length : 0;

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 86_400_000;
  const recent = orders.filter((o) => new Date(o.created_at).getTime() >= sevenDaysAgo);
  const ordersLast7Days = recent.length;
  const revenueLast7Days = sum(recent.filter((o) => o.status === "completed"), (o) => o.total);

  const byStatus = ORDER_STATUSES.map((status) => ({
    status, count: orders.filter((o) => o.status === status).length,
  }));
  const byPayMethod = PAY_METHODS.map((method) => ({
    method, count: orders.filter((o) => o.pay_method === method).length,
  })).filter((x) => x.count > 0);
  const byPayStatus = PAY_STATUSES.map((status) => ({
    status, count: orders.filter((o) => o.pay_status === status).length,
  }));
  const byZone: Array<{ zone: string; count: number }> = [
    ...ZONES.map((zone) => ({ zone, count: orders.filter((o) => o.zone_id === zone).length })),
    { zone: "pickup", count: orders.filter((o) => o.mode === "pickup").length },
  ];

  const live = products.filter((p) => !p.archived);
  const liveProducts = live.length;
  const outOfStock = live.filter((p) => p.stock_status === "out").length;
  const lowStock = live.filter((p) => p.stock_status === "low").length;
  const totalViews = sum(live, (p) => p.views || 0);
  const totalWaClicks = sum(live, (p) => p.wa_clicks || 0);
  const clickThroughRate = totalViews ? totalWaClicks / totalViews : 0;

  // Top products by units sold, derived from every order's line items —
  // orders store a snapshot of {name, qty, price} per line, so this works
  // even for archived/renamed/deleted products.
  const movers = new Map<string, { qty: number; revenue: number }>();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    for (const item of o.items || []) {
      const cur = movers.get(item.name) || { qty: 0, revenue: 0 };
      cur.qty += item.qty;
      cur.revenue += item.qty * item.price;
      movers.set(item.name, cur);
    }
  }
  const topProducts = [...movers.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  // Daily revenue/order-count/units trend, last 14 days, oldest first.
  const dailyLast14: DailyPoint[] = [];
  for (let i = 13; i >= 0; i--) {
    const dayStart = startOfDay(now - i * 86_400_000);
    const dayEnd = dayStart + 86_400_000;
    const dayOrders = orders.filter((o) => {
      const t = new Date(o.created_at).getTime();
      return t >= dayStart && t < dayEnd;
    });
    const dayCompleted = dayOrders.filter((o) => o.status === "completed");
    dailyLast14.push({
      date: new Date(dayStart).toISOString().slice(0, 10),
      revenue: sum(dayCompleted, (o) => o.total),
      orders: dayOrders.length,
      qty: sumUnits(dayCompleted),
      subtotal: sum(dayCompleted, (o) => o.subtotal),
      fee: sum(dayCompleted, (o) => o.fee),
    });
  }

  const yearly = yearlySeries(orders);

  return {
    totalRevenue, pendingRevenue, totalOrders: orders.length, completedOrders: completed.length,
    avgOrderValue, cancellationRate, ordersLast7Days, revenueLast7Days,
    byStatus, byPayMethod, byPayStatus, byZone,
    liveProducts, outOfStock, lowStock, totalViews, totalWaClicks, clickThroughRate,
    topProducts, dailyLast14,
    monthlyLast12: monthlySeries(orders, 12),
    quarterlyLast8: quarterlySeries(orders, 8),
    yearly,
    drillData: buildDrillData(orders, yearly),
  };
}

/** Last `count` calendar months, oldest first, labelled "2026-08" style —
 * unambiguous and sorts correctly as plain text. */
export function monthlySeries(orders: Order[], count: number): PeriodPoint[] {
  const now = new Date();
  const points: PeriodPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = d.getTime();
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    points.push(periodPoint(orders, start, end, label));
  }
  return points;
}

/** Last `count` calendar quarters, oldest first, labelled "2026-Q3". */
export function quarterlySeries(orders: Order[], count: number): PeriodPoint[] {
  const now = new Date();
  const currentQ = Math.floor(now.getMonth() / 3);
  const points: PeriodPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const totalQIndex = now.getFullYear() * 4 + currentQ - i;
    const year = Math.floor(totalQIndex / 4);
    const q = totalQIndex % 4;
    const start = new Date(year, q * 3, 1).getTime();
    const end = new Date(year, q * 3 + 3, 1).getTime();
    points.push(periodPoint(orders, start, end, `${year}-Q${q + 1}`));
  }
  return points;
}

/** Every calendar year that has at least one order, oldest first. Falls
 * back to the current year alone for a brand-new store with no history. */
export function yearlySeries(orders: Order[]): PeriodPoint[] {
  const years = new Set<number>(orders.map((o) => new Date(o.created_at).getFullYear()));
  years.add(new Date().getFullYear());
  return [...years].sort().map((year) => {
    const start = new Date(year, 0, 1).getTime();
    const end = new Date(year + 1, 0, 1).getTime();
    return periodPoint(orders, start, end, String(year));
  });
}

function periodPoint(orders: Order[], start: number, end: number, label: string): PeriodPoint {
  const inRange = orders.filter((o) => {
    const t = new Date(o.created_at).getTime();
    return t >= start && t < end;
  });
  const completed = inRange.filter((o) => o.status === "completed");
  return {
    label,
    revenue: sum(completed, (o) => o.total),
    orders: inRange.length,
    qty: sumUnits(completed),
    subtotal: sum(completed, (o) => o.subtotal),
    fee: sum(completed, (o) => o.fee),
  };
}

// ---------------------------------------------------------------------
// Drill-down hierarchy: Year → Quarter → Month → Day. Precomputed once,
// entirely, for every year that has data (plus the current year) — a
// store's history is small enough that this is cheap even fully expanded,
// and it means the chart can drill down client-side with zero extra
// server round-trips.
// ---------------------------------------------------------------------

export interface DrillPoint extends PeriodPoint { key: number }
export interface DrillData {
  years: DrillPoint[];                              // key = the year itself, e.g. 2026
  quartersByYear: Record<number, DrillPoint[]>;      // key = quarter index 0-3
  monthsByYearQuarter: Record<string, DrillPoint[]>; // "year-quarterIndex" → key = month index 0-11
  daysByYearMonth: Record<string, DailyPoint[]>;     // "year-monthIndex" → full day list
}

export function buildDrillData(orders: Order[], years: PeriodPoint[]): DrillData {
  const quartersByYear: Record<number, DrillPoint[]> = {};
  const monthsByYearQuarter: Record<string, DrillPoint[]> = {};
  const daysByYearMonth: Record<string, DailyPoint[]> = {};

  for (const y of years) {
    const year = Number(y.label);
    const quarters: DrillPoint[] = [];

    for (let q = 0; q < 4; q++) {
      const qStart = new Date(year, q * 3, 1).getTime();
      const qEnd = new Date(year, q * 3 + 3, 1).getTime();
      quarters.push({ ...periodPoint(orders, qStart, qEnd, `Q${q + 1}`), key: q });

      const months: DrillPoint[] = [];
      for (let mi = q * 3; mi < q * 3 + 3; mi++) {
        const mStart = new Date(year, mi, 1).getTime();
        const mEnd = new Date(year, mi + 1, 1).getTime();
        const label = String(mi + 1).padStart(2, "0");
        months.push({ ...periodPoint(orders, mStart, mEnd, label), key: mi });

        const daysInMonth = new Date(year, mi + 1, 0).getDate();
        const days: DailyPoint[] = [];
        for (let d = 1; d <= daysInMonth; d++) {
          const dayStart = new Date(year, mi, d).getTime();
          const dayEnd = dayStart + 86_400_000;
          const dayOrders = orders.filter((o) => {
            const t = new Date(o.created_at).getTime();
            return t >= dayStart && t < dayEnd;
          });
          const dayCompleted = dayOrders.filter((o) => o.status === "completed");
          days.push({
            date: new Date(dayStart).toISOString().slice(0, 10),
            revenue: sum(dayCompleted, (o) => o.total),
            orders: dayOrders.length,
            qty: sumUnits(dayCompleted),
            subtotal: sum(dayCompleted, (o) => o.subtotal),
            fee: sum(dayCompleted, (o) => o.fee),
          });
        }
        daysByYearMonth[`${year}-${mi}`] = days;
      }
      monthsByYearQuarter[`${year}-${q}`] = months;
    }
    quartersByYear[year] = quarters;
  }

  return {
    years: years.map((y) => ({ ...y, key: Number(y.label) })),
    quartersByYear, monthsByYearQuarter, daysByYearMonth,
  };
}

/** Total units across every line item of the given orders — mirrors
 * revenue's "completed only" convention so the two charts stay directly
 * comparable day-for-day. (topProducts, a separate feature, deliberately
 * uses a looser non-cancelled rule and is untouched by this.) */
function sumUnits(orders: Order[]): number {
  let total = 0;
  for (const o of orders) {
    for (const item of o.items || []) total += item.qty;
  }
  return total;
}

function sum<T>(arr: T[], f: (x: T) => number): number {
  return arr.reduce((a, x) => a + (f(x) || 0), 0);
}
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
