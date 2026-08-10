"use server";
import * as XLSX from "xlsx";
import { adminOrders, adminProducts } from "@/lib/data/admin";
import { computeAdminStats, monthlySeries, quarterlySeries, yearlySeries } from "@/lib/stats";
import { requireAdmin } from "./guard";

export async function exportStatsExcel() {
  await requireAdmin();
  const [orders, products] = await Promise.all([adminOrders(), adminProducts()]);
  const stats = computeAdminStats(orders, products);

  const wb = XLSX.utils.book_new();

  // --- Summary ---
  const summaryRows = [
    ["Metric", "Value"],
    ["Total revenue (completed orders)", stats.totalRevenue],
    ["Pending revenue", stats.pendingRevenue],
    ["Total orders", stats.totalOrders],
    ["Completed orders", stats.completedOrders],
    ["Average order value", Number(stats.avgOrderValue.toFixed(2))],
    ["Cancellation rate", `${Math.round(stats.cancellationRate * 100)}%`],
    ["Orders last 7 days", stats.ordersLast7Days],
    ["Revenue last 7 days", stats.revenueLast7Days],
    ["Live products", stats.liveProducts],
    ["Out of stock", stats.outOfStock],
    ["Low stock", stats.lowStock],
    ["Total product views", stats.totalViews],
    ["Total WhatsApp clicks", stats.totalWaClicks],
    ["Click-through rate", `${Math.round(stats.clickThroughRate * 100)}%`],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Summary");

  // --- Orders (every field, one row each — the raw material for pivoting) ---
  const orderRows = orders.map((o) => ({
    Ref: o.ref,
    Date: new Date(o.created_at).toISOString().slice(0, 19).replace("T", " "),
    Buyer: o.buyer_name,
    Phone: o.buyer_phone,
    Status: o.status,
    "Payment method": o.pay_method,
    "Payment status": o.pay_status,
    Mode: o.mode,
    Zone: o.zone_id || "",
    Municipality: o.municipality || "",
    Items: (o.items || []).map((i) => `${i.name} x${i.qty}`).join("; "),
    Subtotal: o.subtotal,
    Fee: o.fee,
    Total: o.total,
    Cancelled: o.cancel_requested_at ? "yes" : "no",
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(orderRows.length ? orderRows : [{ Ref: "(no orders yet)" }]),
    "Orders"
  );

  // --- Revenue by day / month / quarter / year ---
  const dailyRows = stats.dailyLast14.map((d) => ({ Date: d.date, Revenue: d.revenue, Orders: d.orders }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyRows), "Revenue - Daily");

  const monthlyRows = monthlySeries(orders, 24).map((m) => ({ Month: m.label, Revenue: m.revenue, Orders: m.orders }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthlyRows), "Revenue - Monthly");

  const quarterlyRows = quarterlySeries(orders, 12).map((q) => ({ Quarter: q.label, Revenue: q.revenue, Orders: q.orders }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(quarterlyRows), "Revenue - Quarterly");

  const yearlyRows = yearlySeries(orders).map((y) => ({ Year: y.label, Revenue: y.revenue, Orders: y.orders }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(yearlyRows), "Revenue - Yearly");

  // --- Breakdowns ---
  const breakdownRows = [
    ...stats.byStatus.map((r) => ({ Category: "Status", Key: r.status, Count: r.count })),
    ...stats.byPayMethod.map((r) => ({ Category: "Payment method", Key: r.method, Count: r.count })),
    ...stats.byPayStatus.map((r) => ({ Category: "Payment status", Key: r.status, Count: r.count })),
    ...stats.byZone.map((r) => ({ Category: "Delivery zone", Key: r.zone, Count: r.count })),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(breakdownRows), "Breakdowns");

  // --- Top products ---
  const topRows = stats.topProducts.map((p) => ({ Product: p.name, "Units sold": p.qty, Revenue: p.revenue }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(topRows.length ? topRows : [{ Product: "(no sales yet)" }]),
    "Top Products"
  );

  // --- Products (full catalog snapshot) ---
  const productRows = products.map((p) => ({
    Ref: p.ref, Name: p.name, Price: p.price, Stock: p.stock_status, Qty: p.qty,
    Archived: p.archived ? "yes" : "no", Views: p.views, "WhatsApp clicks": p.wa_clicks,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(productRows), "Products");

  const buffer = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  const filename = `loja-aiai-statistics-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return { base64: buffer, filename };
}
