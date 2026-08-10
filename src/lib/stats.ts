import type { Order, Product } from "@/lib/types";

export interface DailyPoint { date: string; revenue: number; orders: number }

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

  // trend
  dailyLast14: DailyPoint[];
}

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

  // Daily revenue/order-count trend, last 14 days, oldest first.
  const dailyLast14: DailyPoint[] = [];
  for (let i = 13; i >= 0; i--) {
    const dayStart = startOfDay(now - i * 86_400_000);
    const dayEnd = dayStart + 86_400_000;
    const dayOrders = orders.filter((o) => {
      const t = new Date(o.created_at).getTime();
      return t >= dayStart && t < dayEnd;
    });
    dailyLast14.push({
      date: new Date(dayStart).toISOString().slice(0, 10),
      revenue: sum(dayOrders.filter((o) => o.status === "completed"), (o) => o.total),
      orders: dayOrders.length,
    });
  }

  return {
    totalRevenue, pendingRevenue, totalOrders: orders.length, completedOrders: completed.length,
    avgOrderValue, cancellationRate, ordersLast7Days, revenueLast7Days,
    byStatus, byPayMethod, byPayStatus, byZone,
    liveProducts, outOfStock, lowStock, totalViews, totalWaClicks, clickThroughRate,
    topProducts, dailyLast14,
  };
}

function sum<T>(arr: T[], f: (x: T) => number): number {
  return arr.reduce((a, x) => a + (f(x) || 0), 0);
}
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
