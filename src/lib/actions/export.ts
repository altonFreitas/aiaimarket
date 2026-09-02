"use server";
import ExcelJS from "exceljs";
import { adminOrdersCapped, adminProducts } from "@/lib/data/admin";
import { computeAdminStats, monthlySeries, quarterlySeries, yearlySeries } from "@/lib/stats";
import { requireAdmin } from "./guard";
import { storeDay } from "@/lib/tz";

/* Was `xlsx` (SheetJS). Replaced because the npm build of that package
 * carries an unfixable prototype-pollution advisory (GHSA-4r6h-8v6p-xvw6)
 * and a ReDoS one -- SheetJS moved distribution off npm and the published
 * versions are frozen at the vulnerable release. Nothing here parses
 * untrusted spreadsheets, so the practical risk was low, but "known-
 * vulnerable dependency, no fix available" is not a state to ship a store
 * in when a maintained alternative writes the same file format.
 *
 * The exported contract ({ base64, filename }) is unchanged, so
 * ExportExcelButton needed no edits. */

/** Column widths sized from the content, so the admin does not open the
 * file to a wall of ### and have to widen every column by hand. */
function autoFitColumns(ws: ExcelJS.Worksheet, headers: string[]) {
  ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.min(42, Math.max(12, h.length + 4)) }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/** Sheet from an array of objects, mirroring the old json_to_sheet(). */
function sheetFromObjects(wb: ExcelJS.Workbook, name: string, rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name);
  if (!rows.length) return ws;

  const headers = Object.keys(rows[0]);
  autoFitColumns(ws, headers);
  for (const r of rows) ws.addRow(headers.map((h) => r[h] ?? ""));

  // Widen any column whose data is consistently longer than its header.
  headers.forEach((h, i) => {
    const longest = rows.reduce((m, r) => Math.max(m, String(r[h] ?? "").length), h.length);
    ws.getColumn(i + 1).width = Math.min(60, Math.max(12, longest + 2));
  });
  return ws;
}

/** Sheet from a plain array-of-arrays, mirroring the old aoa_to_sheet(). */
function sheetFromRows(wb: ExcelJS.Workbook, name: string, rows: unknown[][]) {
  const ws = wb.addWorksheet(name);
  for (const r of rows) ws.addRow(r);
  ws.getRow(1).font = { bold: true };
  ws.getColumn(1).width = 38;
  ws.getColumn(2).width = 18;
  return ws;
}

export async function exportStatsExcel() {
  await requireAdmin();
  const [ordersRead, products] = await Promise.all([adminOrdersCapped(), adminProducts()]);
  const orders = ordersRead.rows;
  const stats = computeAdminStats(orders, products);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Loja AIAI";
  wb.created = new Date();

  // A spreadsheet outlives the screen it came from and gets forwarded to
  // people who never saw the caveat. If these figures stand on part of the
  // book, the file has to say so on its own first sheet.
  const coverage: Array<[string, string | number]> = ordersRead.truncated
    ? [["NOTE — these figures are incomplete",
        `Only the most recent ${ordersRead.cap.toLocaleString("en-US")} orders are included` +
        (ordersRead.oldestKept ? `, from ${ordersRead.oldestKept.slice(0, 10)} onwards` : "")],
       ["", ""]]
    : [];

  // --- Summary ---
  sheetFromRows(wb, "Summary", [
    ...coverage,
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
  ]);

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
  sheetFromObjects(wb, "Orders", orderRows.length ? orderRows : [{ Ref: "(no orders yet)" }]);

  // --- Revenue by day / month / quarter / year ---
  sheetFromObjects(wb, "Revenue - Daily",
    stats.dailyLast14.map((d) => ({ Date: d.date, Revenue: d.revenue, Orders: d.orders })));
  sheetFromObjects(wb, "Revenue - Monthly",
    monthlySeries(orders, 24).map((m) => ({ Month: m.label, Revenue: m.revenue, Orders: m.orders })));
  sheetFromObjects(wb, "Revenue - Quarterly",
    quarterlySeries(orders, 12).map((q) => ({ Quarter: q.label, Revenue: q.revenue, Orders: q.orders })));
  sheetFromObjects(wb, "Revenue - Yearly",
    yearlySeries(orders).map((y) => ({ Year: y.label, Revenue: y.revenue, Orders: y.orders })));

  // --- Breakdowns ---
  sheetFromObjects(wb, "Breakdowns", [
    ...stats.byStatus.map((r) => ({ Category: "Status", Key: r.status, Count: r.count })),
    ...stats.byPayMethod.map((r) => ({ Category: "Payment method", Key: r.method, Count: r.count })),
    ...stats.byPayStatus.map((r) => ({ Category: "Payment status", Key: r.status, Count: r.count })),
    ...stats.byZone.map((r) => ({ Category: "Delivery zone", Key: r.zone, Count: r.count })),
  ]);

  // --- Top products ---
  const topRows = stats.topProducts.map((p) => ({ Product: p.name, "Units sold": p.qty, Revenue: p.revenue }));
  sheetFromObjects(wb, "Top Products", topRows.length ? topRows : [{ Product: "(no sales yet)" }]);

  // --- Products (full catalog snapshot) ---
  sheetFromObjects(wb, "Products", products.map((p) => ({
    Ref: p.ref, Name: p.name, Price: p.price, Stock: p.stock_status, Qty: p.qty,
    Archived: p.archived ? "yes" : "no", Views: p.views, "WhatsApp clicks": p.wa_clicks,
  })));

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `loja-aiai-statistics-${storeDay()}.xlsx`;
  return { base64: Buffer.from(buffer).toString("base64"), filename };
}
