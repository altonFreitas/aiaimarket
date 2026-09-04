"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { BarSeries, RankedBars } from "@/components/admin/Charts";
import SalesTable from "@/components/admin/sales/SalesTable";
import { money } from "@/lib/utils";
import {
  computeSalesKpis, customerAnalysis, deliveryDelayDays, deliveryState,
  filterIsActive, filterSalesLines, groupOrders, growth, monthKeys,
  salesByCategory, salesByCustomer, salesByMonth, salesByMunicipality,
  salesByProduct, salesByQuarter, salesByWeek, salesByYear, shiftIso,
  statusBreakdown, paymentSummary,
  PENDING_STATUSES, SALES_STATUSES, PERIOD_PRESETS, presetRange, activePreset,
  type SalesFilter,
} from "@/lib/sales";
import { unpackSalesLines, type PackedSalesLines } from "@/lib/salesWire";
import { t } from "@/lib/i18n";
import type { Category, Lang, OrderStatus } from "@/lib/types";

/* A store's own sales, on the same engine the owner's dashboard runs on.
 *
 * WHAT IS THE SAME, AND WHY. Everything here -- the period presets, growth
 * against the previous period, the monthly/quarterly/weekly series, sales
 * by category and municipality, top products and customers, the status and
 * payment breakdowns, the backlog, late deliveries, new-versus-returning
 * customers, the searchable line table -- is the owner's own code reading
 * the store's own lines. The first version of this screen had four numbers
 * and two charts because it had its own small aggregation; this one is not
 * bigger because more was written, it is bigger because nothing was.
 *
 * WHAT IS DIFFERENT, AND WHY.
 *
 * 1. No margin, gross profit, cost, or cost coverage. Those describe what
 *    the MARKETPLACE paid for the goods. The lines behind this screen carry
 *    no cost at all (lib/data/sellerSales.ts removes it before they are
 *    built), so the columns are dropped rather than rendered as dashes --
 *    an em dash reads as data missing, and this is not missing.
 *
 * 2. No seller filter and no seller comparison. There is one store here,
 *    and one store must never read another's numbers.
 *
 * 3. No sales targets. sales_targets has no seller_id yet, so there is
 *    nothing per-store to compare against; a target panel showing the
 *    marketplace's own goal would be worse than none.
 *
 * 4. Commission and earnings are ADDED, because they are the seller's
 *    question and the owner has no equivalent: what the marketplace takes
 *    and what is left.
 */

const STATUS_PILL: Record<string, string> = {
  new: "muted", confirmed: "info", preparing: "info", out: "info",
  arrived: "ok", completed: "ok", cancelled: "bad",
};
const DELIVERY_PILL: Record<string, string> = {
  delivered_on_time: "ok", delivered_late: "warn", due: "info",
  delayed: "bad", no_date: "muted", cancelled: "muted",
};

function pct(n: number | null, digits = 0): string {
  return n == null ? "—" : `${(n * 100).toFixed(digits)}%`;
}
function signed(n: number | null): { text: string; up: boolean } | null {
  if (n == null) return null;
  return { text: `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`, up: n >= 0 };
}

function Kpi({
  label, value, delta, note,
}: {
  label: string; value: string;
  delta?: { text: string; up: boolean } | null; note?: string;
}) {
  return (
    <div>
      <b>{value}</b>
      <span>{label}</span>
      {delta && <em className={delta.up ? "up" : "down"}>{delta.text}</em>}
      {note && <em className="hint">{note}</em>}
    </div>
  );
}

interface Props {
  lang: Lang;
  lines: PackedSalesLines;
  categories: Category[];
  /** The rate that applies to THIS store: their own if they negotiated one,
   * otherwise the platform default. Resolved on the server. */
  rate: number;
  /** Their live products with no sales in the window at all. */
  unsold: Array<{ id: string; name: string }>;
  today: string;
}

export default function SellerSales({
  lang, lines: wire, categories, rate, unsold, today,
}: Props) {
  const lines = useMemo(() => unpackSalesLines(wire), [wire]);
  const [f, setF] = useState<SalesFilter>({});
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const set = (patch: Partial<SalesFilter>) => setF((cur) => ({ ...cur, ...patch }));
  const chosenPreset = activePreset(f.from, f.to, today);

  const rows = useMemo(() => filterSalesLines(lines, f, today), [lines, f, today]);
  const orders = useMemo(() => groupOrders(rows), [rows]);

  // The same window, shifted back by its own length: "up 12% on the month
  // before" needs a month before of exactly the same size, or the comparison
  // is between four weeks and five.
  const priorLines = useMemo(() => {
    if (!f.from || !f.to) return [];
    const span = Math.max(1, Math.round(
      (Date.parse(f.to) - Date.parse(f.from)) / 86400000) + 1);
    return filterSalesLines(lines, {
      ...f, from: shiftIso(f.from, -span), to: shiftIso(f.to, -span),
    }, today);
  }, [lines, f, today]);

  const kpis = useMemo(
    () => computeSalesKpis(rows, { today, priorLines: lines }), [rows, today, lines]);
  const previous = useMemo(
    () => computeSalesKpis(priorLines, { today, priorLines: lines }),
    [priorLines, today, lines]);

  const currentYearRows = useMemo(
    () => rows.filter((l) => l.date.startsWith(String(year))), [rows, year]);
  const monthly = useMemo(
    () => salesByMonth(currentYearRows, monthKeys(year)), [currentYearRows, year]);
  const prevMonthly = useMemo(
    () => salesByMonth(rows.filter((l) => l.date.startsWith(String(year - 1))), monthKeys(year - 1)),
    [rows, year]);
  const quarterly = useMemo(() => salesByQuarter(currentYearRows, year), [currentYearRows, year]);
  const weekly = useMemo(() => salesByWeek(rows, today, 12), [rows, today]);
  const yearly = useMemo(() => salesByYear(rows), [rows]);

  const byProduct = useMemo(() => salesByProduct(rows), [rows]);
  const byCategory = useMemo(() => salesByCategory(rows), [rows]);
  const byCustomer = useMemo(() => salesByCustomer(rows), [rows]);
  const byMunicipality = useMemo(() => salesByMunicipality(rows), [rows]);
  const customers = useMemo(
    () => customerAnalysis(rows, { today, priorLines: lines }), [rows, lines, today]);
  const statuses = useMemo(() => statusBreakdown(rows), [rows]);
  const payments = useMemo(() => paymentSummary(rows), [rows]);

  const pending = useMemo(
    () => orders.filter((o) => PENDING_STATUSES.includes(o.status))
      .sort((a, b) => (a.expectedDelivery || "9999").localeCompare(b.expectedDelivery || "9999")),
    [orders]);
  const delayed = useMemo(
    () => orders.filter((o) => deliveryState(o, today) === "delayed")
      .sort((a, b) => (deliveryDelayDays(b, today) ?? 0) - (deliveryDelayDays(a, today) ?? 0)),
    [orders, today]);

  const years = useMemo(() => {
    const set = new Set(lines.map((l) => Number(l.date.slice(0, 4))));
    set.add(Number(today.slice(0, 4)));
    return [...set].sort((a, b) => b - a);
  }, [lines, today]);
  const municipalities = useMemo(
    () => [...new Set(lines.map((l) => l.municipality).filter(Boolean))].sort(), [lines]);

  const revenueGrowth = signed(growth(kpis.revenue, previous.revenue));

  // The seller's own question, which the owner's dashboard has no version
  // of. Charged on delivered revenue, the same basis as the ledger on their
  // dashboard -- if this were charged on everything sold, the two screens
  // would give different answers for what they are owed.
  const commission = Math.round(kpis.deliveredRevenue * rate) / 100;
  const netEarnings = Math.round((kpis.deliveredRevenue - commission) * 100) / 100;

  const paymentTotal = payments.byMethod.reduce((a, x) => a + x.value, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("sellerSales", lang)}</h1>
          <p className="sub">{t("commissionRate", lang)}: {rate}%</p>
        </div>
      </div>

      {/* ---- filters: the same set the owner has, minus the seller one ---- */}
      <div className="panel filters">
        <div className="bar preset-bar">
          {PERIOD_PRESETS.map((p) => (
            <button key={p} type="button"
              className={"chip" + (chosenPreset === p ? " is-on" : "")}
              onClick={() => set(presetRange(p, today))}>
              {t("range_" + p, lang)}
            </button>
          ))}
          {(f.from || f.to) && (
            <button type="button" className="chip" onClick={() => set({ from: "", to: "" })}>
              {t("allTime", lang)}
            </button>
          )}
        </div>
        <div className="bar">
          <input type="search" placeholder={t("searchSales", lang)} value={f.q || ""}
            onChange={(e) => set({ q: e.target.value })} style={{ flex: 1, minWidth: 150 }} />
          <input type="date" value={f.from || ""} aria-label={t("from", lang)}
            onChange={(e) => set({ from: e.target.value })} />
          <input type="date" value={f.to || ""} aria-label={t("to", lang)}
            onChange={(e) => set({ to: e.target.value })} />
          <select value={f.status || ""} onChange={(e) => set({ status: e.target.value as OrderStatus | "" })}>
            <option value="">{t("allStatuses", lang)}</option>
            {SALES_STATUSES.map((s) => <option key={s} value={s}>{t("st_" + s, lang)}</option>)}
          </select>
          <select value={f.categoryId || ""} onChange={(e) => set({ categoryId: e.target.value })}>
            <option value="">{t("categories", lang)}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={f.municipality || ""} onChange={(e) => set({ municipality: e.target.value })}>
            <option value="">{t("allMunicipalities", lang)}</option>
            {municipalities.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {filterIsActive(f) && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setF({})}>
              {t("clearFilters", lang)}
            </button>
          )}
        </div>
      </div>

      {/* ---- headline numbers ---- */}
      <div className="stat stat-fit">
        <Kpi label={t("grossSales", lang)} value={money(kpis.revenue)} delta={revenueGrowth} />
        <Kpi label={t("salesOrders", lang)} value={String(kpis.orders)} />
        <Kpi label={t("quantitySold", lang)} value={String(kpis.qty)} />
        <Kpi label={t("customers", lang)} value={String(kpis.customers)}
          note={`${kpis.activeCustomers} ${t("active", lang).toLowerCase()}`} />
        <Kpi label={t("avgOrderValue", lang)} value={money(kpis.avgOrderValue)} />
        <Kpi label={t("discount", lang)} value={money(kpis.discount)} />
      </div>
      <div className="stat stat-fit">
        <Kpi label={t("deliveredRevenue", lang)} value={money(kpis.deliveredRevenue)} />
        <Kpi label={t("pendingOrders", lang)} value={String(kpis.pendingOrders)}
          note={money(kpis.pendingValue)} />
        <Kpi label={t("deliveredOrders", lang)} value={String(kpis.deliveredOrders)} />
        <Kpi label={t("cancelledOrders", lang)} value={String(kpis.cancelledOrders)}
          note={pct(kpis.cancellationRate)} />
        <Kpi label={t("onTimeDelivery", lang)} value={pct(kpis.onTimeRate)}
          note={kpis.avgFulfilmentDays != null
            ? `${kpis.avgFulfilmentDays.toFixed(1)}d ${t("avgFulfilment", lang)}` : undefined} />
        <Kpi label={t("returningCustomers", lang)} value={String(kpis.returningCustomers)}
          note={`${kpis.newCustomers} ${t("new", lang).toLowerCase()}`} />
      </div>

      {/* ---- what the marketplace takes, and what is left ---- */}
      <div className="panel">
        <h3>{t("sellerEarnings", lang)}</h3>
        <p className="hint" style={{ marginTop: -6 }}>{t("sellerEarningsBasis", lang)}</p>
        <div className="kv"><span>{t("deliveredRevenue", lang)}</span><b>{money(kpis.deliveredRevenue)}</b></div>
        <div className="kv">
          <span>{t("marketplaceCommission", lang)} ({rate}%)</span><b>-{money(commission)}</b>
        </div>
        <div className="kv total"><span>{t("sellerEarnings", lang)}</span><b>{money(netEarnings)}</b></div>
      </div>

      {/* ---- month by month, this year against last ---- */}
      <div className="panel">
        <div className="panel-head">
          <h3>{t("monthlyRevenue", lang)}</h3>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <BarSeries points={monthly.map((m) => ({ label: m.label, value: m.revenue }))}
          emptyLabel={t("noDataYet", lang)} />
        <div className="scroll-x">
          <table className="tbl tbl-compact">
            <thead>
              <tr>
                <th>{t("month", lang)}</th><th className="num">{year}</th>
                <th className="num">{year - 1}</th><th className="num">{t("growth", lang)}</th>
                <th className="num">{t("orders", lang)}</th>
                <th className="num">{t("avgOrderValue", lang)}</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m, i) => {
                const g = signed(growth(m.revenue, prevMonthly[i]?.revenue ?? 0));
                return (
                  <tr key={m.key}>
                    <td>{m.key}</td>
                    <td className="num">{money(m.revenue)}</td>
                    <td className="num hint">{money(prevMonthly[i]?.revenue ?? 0)}</td>
                    <td className={"num " + (g ? (g.up ? "up" : "down") : "")}>{g ? g.text : "—"}</td>
                    <td className="num">{m.orders}</td>
                    <td className="num">{money(m.avgOrderValue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <h3>{t("quarterlySales", lang)} · {year}</h3>
          <BarSeries points={quarterly.map((q) => ({ label: q.label, value: q.revenue }))}
            emptyLabel={t("noDataYet", lang)} />
        </div>
        <div className="panel">
          <h3>{t("weeklySales", lang)}</h3>
          <BarSeries points={weekly.map((w) => ({ label: w.label, value: w.revenue }))}
            emptyLabel={t("noDataYet", lang)} />
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <h3>{t("salesByCategory", lang)}</h3>
          <RankedBars
            rows={byCategory.map((c) => ({
              key: c.key, label: c.label, value: c.revenue,
              share: kpis.revenue > 0 ? c.revenue / kpis.revenue : 0,
              meta: `${c.qty} ${t("units", lang).toLowerCase()}`,
            }))}
            emptyLabel={t("noDataYet", lang)}
            onSelect={(key) => set({ categoryId: f.categoryId === key ? "" : key })}
          />
        </div>
        <div className="panel">
          <h3>{t("salesByMunicipality", lang)}</h3>
          <RankedBars
            rows={byMunicipality.map((m) => ({
              key: m.key, label: m.label, value: m.revenue,
              share: kpis.revenue > 0 ? m.revenue / kpis.revenue : 0,
              meta: `${m.orders} ${t("orders", lang).toLowerCase()}`,
            }))}
            emptyLabel={t("noDataYet", lang)}
          />
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <h3>{t("topProducts", lang)}</h3>
          <RankedBars
            rows={byProduct.map((p) => ({
              key: p.key, label: p.label, value: p.revenue,
              share: kpis.revenue > 0 ? p.revenue / kpis.revenue : 0,
              meta: `${p.qty} ${t("units", lang).toLowerCase()}`,
            }))}
            emptyLabel={t("noDataYet", lang)}
          />
        </div>
        <div className="panel">
          <h3>{t("topCustomers", lang)}</h3>
          <RankedBars
            rows={byCustomer.map((c) => ({
              key: c.key, label: c.label, value: c.revenue,
              share: kpis.revenue > 0 ? c.revenue / kpis.revenue : 0,
              meta: `${c.orders} ${t("orders", lang).toLowerCase()}`,
            }))}
            emptyLabel={t("noDataYet", lang)}
          />
        </div>
      </div>

      {/* ---- status, and where the money is ---- */}
      <div className="panel">
        <h3>{t("orderStatus", lang)}</h3>
        <div className="status-tiles">
          {statuses.map((s) => (
            <button key={s.status} type="button"
              className={"status-tile" + (f.status === s.status ? " is-on" : "")}
              onClick={() => set({ status: f.status === s.status ? "" : s.status })}>
              <b>{s.count}</b>
              <span>{t("st_" + s.status, lang)}</span>
              <em>{money(s.value)}</em>
            </button>
          ))}
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <h3>{t("payments", lang)}</h3>
          <div className="stat stat-fit">
            <div><b>{money(payments.collected)}</b><span>{t("collected", lang)}</span></div>
            <div>
              <b className={payments.outstanding > 0 ? "bad-text" : ""}>{money(payments.outstanding)}</b>
              <span>{t("outstandingMoney", lang)}</span>
              {payments.outstandingOrders > 0 && (
                <em className="hint">{payments.outstandingOrders} {t("orders", lang).toLowerCase()}</em>
              )}
            </div>
          </div>
          <div className="scroll-x">
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th>{t("paymentStatus", lang)}</th>
                  <th className="num">{t("orders", lang)}</th>
                  <th className="num">{t("value", lang)}</th>
                </tr>
              </thead>
              <tbody>
                {payments.byStatus.length ? payments.byStatus.map((b) => (
                  <tr key={b.key}>
                    <td>{t("ps_" + b.key, lang)}</td>
                    <td className="num">{b.count}</td>
                    <td className="num">{money(b.value)}</td>
                  </tr>
                )) : <tr><td colSpan={3} className="hint">{t("noDataYet", lang)}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h3>{t("paymentMethodBreakdown", lang)}</h3>
          <RankedBars
            rows={payments.byMethod.map((b) => ({
              key: b.key, label: t("pm_" + b.key, lang), value: b.value,
              share: paymentTotal > 0 ? b.value / paymentTotal : 0,
              meta: `${b.count} ${t("orders", lang).toLowerCase()}`,
            }))}
            emptyLabel={t("noDataYet", lang)}
          />
        </div>
      </div>

      {/* ---- the work waiting, and the work that is late ---- */}
      <div className="two-col">
        <div className="panel">
          <h3>{t("pendingOrders", lang)}</h3>
          <p className="hint">{money(kpis.pendingValue)} {t("inBacklog", lang)}</p>
          <div className="scroll-x">
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th>{t("order", lang)}</th><th>{t("customer", lang)}</th>
                  <th>{t("status", lang)}</th><th className="num">{t("value", lang)}</th>
                  <th>{t("expectedDelivery", lang)}</th>
                </tr>
              </thead>
              <tbody>
                {pending.length ? pending.slice(0, 12).map((o) => (
                  <tr key={o.orderId}>
                    <td><Link href="/seller/orders" className="mono">{o.ref}</Link></td>
                    <td>{o.customerName}</td>
                    <td><span className={"pill " + STATUS_PILL[o.status]}>{t("st_" + o.status, lang)}</span></td>
                    <td className="num">{money(o.revenue)}</td>
                    <td className="mono">{o.expectedDelivery || "—"}</td>
                  </tr>
                )) : <tr><td colSpan={5} className="hint">{t("noDataYet", lang)}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h3>{t("delayedDeliveries", lang)}</h3>
          <div className="scroll-x">
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th>{t("order", lang)}</th><th>{t("customer", lang)}</th>
                  <th>{t("deliveryStatus", lang)}</th>
                  <th className="num">{t("delayDays", lang)}</th>
                  <th className="num">{t("value", lang)}</th>
                </tr>
              </thead>
              <tbody>
                {delayed.length ? delayed.slice(0, 12).map((o) => {
                  const st = deliveryState(o, today);
                  return (
                    <tr key={o.orderId}>
                      <td><Link href="/seller/orders" className="mono">{o.ref}</Link></td>
                      <td>{o.customerName}</td>
                      <td><span className={"pill " + DELIVERY_PILL[st]}>{t("dstate_" + st, lang)}</span></td>
                      <td className="num">{deliveryDelayDays(o, today) ?? "—"}</td>
                      <td className="num">{money(o.revenue)}</td>
                    </tr>
                  );
                }) : <tr><td colSpan={5} className="hint">{t("nothingDelayed", lang)}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ---- who buys, and whether they come back ---- */}
      <div className="panel">
        <h3>{t("customerAnalysis", lang)}</h3>
        <div className="scroll-x">
          <table className="tbl tbl-compact">
            <thead>
              <tr>
                <th>{t("customer", lang)}</th><th className="num">{t("orders", lang)}</th>
                <th className="num">{t("qty", lang)}</th><th className="num">{t("revenue", lang)}</th>
                <th className="num">{t("avgOrderValue", lang)}</th>
                <th>{t("lastPurchase", lang)}</th><th className="num">{t("trend", lang)}</th>
                <th className="num">{t("outstanding", lang)}</th>
              </tr>
            </thead>
            <tbody>
              {customers.length ? customers.slice(0, 20).map((c) => {
                const tr = signed(c.trend);
                return (
                  <tr key={c.key}>
                    <td>
                      <button type="button" className="linklike"
                        onClick={() => set({ customer: f.customer === c.phone ? "" : c.phone })}>
                        {c.label}
                      </button>
                      {c.isNew && <span className="pill info">{t("new", lang)}</span>}
                      {c.isInactive && <span className="pill muted">{t("inactive", lang)}</span>}
                    </td>
                    <td className="num">{c.orders}</td>
                    <td className="num">{c.qty}</td>
                    <td className="num">{money(c.revenue)}</td>
                    <td className="num">{money(c.orders ? c.revenue / c.orders : 0)}</td>
                    <td className="mono">{c.lastPurchase || "—"}</td>
                    <td className={"num " + (tr ? (tr.up ? "up" : "down") : "")}>{tr ? tr.text : "—"}</td>
                    <td className="num">{c.outstandingOrders ? money(c.outstandingValue) : "—"}</td>
                  </tr>
                );
              }) : <tr><td colSpan={8} className="hint">{t("noDataYet", lang)}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- year on year, once there is more than one ---- */}
      {yearly.length > 1 && (
        <div className="panel">
          <h3>{t("yearOnYear", lang)}</h3>
          <div className="scroll-x">
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th>{t("year", lang)}</th><th className="num">{t("revenue", lang)}</th>
                  <th className="num">{t("orders", lang)}</th><th className="num">{t("qty", lang)}</th>
                  <th className="num">{t("customers", lang)}</th>
                  <th className="num">{t("avgOrderValue", lang)}</th>
                  <th className="num">{t("growth", lang)}</th>
                </tr>
              </thead>
              <tbody>
                {yearly.map((y, i) => {
                  const g = i > 0 ? signed(growth(y.revenue, yearly[i - 1].revenue)) : null;
                  return (
                    <tr key={y.key}>
                      <td>{y.label}</td>
                      <td className="num">{money(y.revenue)}</td>
                      <td className="num">{y.orders}</td>
                      <td className="num">{y.qty}</td>
                      <td className="num">{y.customers}</td>
                      <td className="num">{money(y.avgOrderValue)}</td>
                      <td className={"num " + (g ? (g.up ? "up" : "down") : "")}>{g ? g.text : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- products that sold nothing in this window ---- */}
      {unsold.length > 0 && (
        <div className="panel">
          <h3>{t("neverSold", lang)}</h3>
          <p className="hint">{t("unsoldProductsHint", lang)}</p>
          <div className="chip-row">
            {unsold.slice(0, 30).map((p) => (
              <Link key={p.id} className="chip" href={`/seller/products/${p.id}`}>{p.name}</Link>
            ))}
          </div>
        </div>
      )}

      {/* ---- every line, searchable, exportable ---- */}
      <SalesTable
        lang={lang} lines={rows} today={today}
        showCost={false}
        hrefFor={() => "/seller/orders"}
      />
    </>
  );
}
