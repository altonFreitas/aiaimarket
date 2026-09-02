"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { BarSeries, RankedBars, RateBar } from "../Charts";
import SalesTable from "./SalesTable";
import ExportExcelButton from "../ExportExcelButton";
import { money } from "@/lib/utils";
import {
  buildInsights, buildSalesAlerts, computeSalesKpis, customerAnalysis,
  deliveryDelayDays, deliveryState, filterIsActive, filterSalesLines, groupOrders,
  growth, lowPerformers, monthKeys, rank, salesByCategory, salesByCustomer,
  salesByMonth, salesByMunicipality, salesByProduct, salesByQuarter, salesByWeek,
  salesBySeller, salesByYear, shiftIso, statusBreakdown, targetProgress, totals,
  paymentSummary,
  PENDING_STATUSES, SALES_STATUSES,
  PERIOD_PRESETS, presetRange, activePreset,
  type RankBy, type SalesFilter, type SalesTarget,
} from "@/lib/sales";
import { t } from "@/lib/i18n";
import { unpackSalesLines, type PackedSalesLines } from "@/lib/salesWire";
import type { Category, Lang, OrderStatus, Seller } from "@/lib/types";

/* The whole dashboard is one filtered set feeding every panel. A filter that
 * reached the charts but not the table would be worse than no filter: two
 * numbers on one screen that disagree, with nothing saying why. */

const STATUS_PILL: Record<string, string> = {
  new: "muted", confirmed: "info", preparing: "info", out: "info",
  arrived: "ok", completed: "ok", cancelled: "bad",
};
function pct(n: number | null, digits = 0): string {
  return n == null ? "—" : `${(n * 100).toFixed(digits)}%`;
}
function signed(n: number | null): { text: string; up: boolean } | null {
  if (n == null) return null;
  return { text: `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`, up: n >= 0 };
}
/** Money, or an em dash for an unknown. Never "$0.00" for "we don't know" --
 * that is the single most misleading thing a finance panel can print. */
function moneyOrDash(n: number | null): string {
  return n == null ? "—" : money(n);
}

interface Props {
  lang: Lang;
  /** Packed for the wire; see lib/salesWire.ts. Unpacked once on arrival. */
  lines: PackedSalesLines;
  categories: Category[];
  sellers: Seller[];
  targets: SalesTarget[];
  /** Catalog products with no sales in the window at all (section 19). */
  unsoldProducts: Array<{ id: string; name: string }>;
  today: string;
  /** False until supabase/sales.sql has run. */
  ready: boolean;
}

export default function SalesDashboard({
  lang, lines: wire, categories, sellers, targets, unsoldProducts, today, ready,
}: Props) {
  /* The order book arrives as a dictionary plus rows of integers rather
     than as objects -- about a fifth of the bytes, which on mobile data is
     the difference between a dashboard and a wait. Unpacked once, here;
     everything below works on exactly the objects it always did. */
  const lines = useMemo(() => unpackSalesLines(wire), [wire]);
  const thisYear = Number(today.slice(0, 4));
  const [f, setF] = useState<SalesFilter>({});
  const [year, setYear] = useState(thisYear);
  const [productRank, setProductRank] = useState<RankBy>("revenue");
  const [customerRank, setCustomerRank] = useState<RankBy>("revenue");
  const set = (patch: Partial<SalesFilter>) => setF((s) => ({ ...s, ...patch }));

  // Lit from the filter itself rather than from a separate piece of state,
  // so typing a range by hand into the date boxes correctly lights nothing.
  const chosenPreset = activePreset(f.from, f.to, today);

  // ---- the one filtered set -------------------------------------------
  const rows = useMemo(() => filterSalesLines(lines, f, today), [lines, f, today]);
  const orders = useMemo(() => groupOrders(rows), [rows]);

  // Everything before the window, used only to tell a first-time buyer from
  // a returning one. Without it every customer in view looks new.
  const priorLines = useMemo(
    () => (f.from ? lines.filter((l) => l.date < (f.from as string)) : []),
    [lines, f.from]
  );

  const kpis = useMemo(
    () => computeSalesKpis(rows, { today, priorLines }),
    [rows, today, priorLines]
  );

  // The same span immediately before the current one, so every KPI has an
  // honest comparison rather than a number floating on its own. Falls back
  // to last year when no explicit range is set.
  const previous = useMemo(() => {
    if (f.from && f.to) {
      const span = Math.max(1, Math.round(
        (Date.parse(f.to) - Date.parse(f.from)) / 86_400_000
      ));
      return totals(filterSalesLines(lines, {
        ...f, from: shiftIso(f.from, -span - 1), to: shiftIso(f.from, -1),
      }, today));
    }
    return totals(filterSalesLines(lines, { ...f, from: `${year - 1}-01-01`, to: `${year - 1}-12-31` }, today));
  }, [lines, f, year, today]);

  const currentYearRows = useMemo(
    () => rows.filter((l) => l.date.startsWith(String(year))), [rows, year]
  );

  const monthly = useMemo(() => salesByMonth(currentYearRows, monthKeys(year)), [currentYearRows, year]);
  const prevMonthly = useMemo(
    () => salesByMonth(lines.filter((l) => l.date.startsWith(String(year - 1))), monthKeys(year - 1)),
    [lines, year]
  );
  const quarterly = useMemo(() => salesByQuarter(currentYearRows, year), [currentYearRows, year]);
  // Weekly, not daily: at this shop's volume most days are zero, so thirty
  // daily bars read as four spikes and noise. Twelve weeks shows the shape
  // of the business.
  const weekly = useMemo(() => salesByWeek(rows, today, 12), [rows, today]);
  const yearly = useMemo(() => salesByYear(rows), [rows]);

  const byProduct = useMemo(() => salesByProduct(rows), [rows]);
  const byCategory = useMemo(() => salesByCategory(rows), [rows]);
  const byCustomer = useMemo(() => salesByCustomer(rows), [rows]);
  const bySeller = useMemo(() => salesBySeller(rows), [rows]);
  const byMunicipality = useMemo(() => salesByMunicipality(rows), [rows]);
  const customers = useMemo(
    () => customerAnalysis(rows, { today, priorLines }), [rows, today, priorLines]
  );
  const statuses = useMemo(() => statusBreakdown(rows), [rows]);
  const payments = useMemo(() => paymentSummary(rows), [rows]);
  const weak = useMemo(
    () => lowPerformers(rows, { unsoldProducts }), [rows, unsoldProducts]
  );

  const alerts = useMemo(() => buildSalesAlerts(rows, {
    today, targets, period: `${year}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
    previousRevenue: previous.revenue,
  }), [rows, today, targets, year, previous.revenue]);

  const insights = useMemo(() => buildInsights(rows, today), [rows, today]);

  const pending = useMemo(
    () => orders
      .filter((o) => (PENDING_STATUSES as readonly string[]).includes(o.status))
      .sort((a, b) => b.revenue - a.revenue),
    [orders]
  );
  const delayed = useMemo(
    () => orders
      .filter((o) => deliveryState(o, today) === "delayed")
      .sort((a, b) => (deliveryDelayDays(b, today) ?? 0) - (deliveryDelayDays(a, today) ?? 0)),
    [orders, today]
  );

  const target = useMemo(
    () => targetProgress(targets, String(year), totals(currentYearRows).revenue),
    [targets, year, currentYearRows]
  );

  const years = useMemo(() => {
    const ys = [...new Set(lines.map((l) => l.date.slice(0, 4)).filter(Boolean))].map(Number);
    return (ys.length ? ys : [thisYear]).sort((a, b) => b - a);
  }, [lines, thisYear]);

  const municipalities = useMemo(
    () => [...new Set(lines.map((l) => l.municipality).filter(Boolean))].sort(),
    [lines]
  );

  const revenueGrowth = signed(growth(kpis.revenue, previous.revenue));
  const profitGrowth = signed(
    kpis.grossProfit != null && previous.grossProfit != null
      ? growth(kpis.grossProfit, previous.grossProfit) : null
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("salesDashboard", lang)}</h1>
          <p className="sub">{t("salesDashboardSub", lang)}</p>
        </div>
        {/* The full workbook export, rehomed from the old statistics page.
            Distinct from the table's CSV: that exports the filtered lines on
            screen, this one the whole book. */}
        <ExportExcelButton lang={lang} />
      </div>

      {!ready && (
        <div className="note info" style={{ marginBottom: 12 }}>
          {t("salesMigrationNeeded", lang)}
        </div>
      )}

      {/* ---- 20. alerts: what needs a decision, above everything else ---- */}
      {alerts.length > 0 && (
        <div className="alerts">
          {alerts.map((a, i) => (
            <div key={a.kind + i} className={"alert alert-" + a.severity}>
              <b>{t("salesAlert_" + a.kind, lang)}</b>
              <span>
                {a.kind === "sales_declining" || a.kind === "high_discounts" || a.kind === "no_cost_data"
                  ? pct(a.value ?? null, 1)
                  : `${a.count}` + (a.value != null ? ` · ${money(a.value)}` : "")}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ---- 24. global filters ---- */}
      <div className="panel filters">
        {/* One click for the question people actually ask. The two date
            boxes below still take any range; these are the six that get
            typed over and over, and each is a whole calendar period so two
            people reading the same screen mean the same thing by it. */}
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
          <select value={f.sellerId || ""} onChange={(e) => set({ sellerId: e.target.value })}>
            <option value="">{t("allSellers", lang)}</option>
            <option value="platform">{t("storesOwn", lang)}</option>
            {sellers.map((s) => <option key={s.id} value={s.id}>{s.store_name}</option>)}
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

      {/* ---- 1. headline KPIs (spec layout row 1) ---- */}
      <div className="stat stat-fit">
        <Kpi label={t("totalSalesRevenue", lang)} value={money(kpis.revenue)} delta={revenueGrowth} />
        <Kpi label={t("salesOrders", lang)} value={String(kpis.orders)} />
        <Kpi label={t("quantitySold", lang)} value={String(kpis.qty)} />
        <Kpi label={t("customers", lang)} value={String(kpis.customers)}
          note={`${kpis.activeCustomers} ${t("active", lang).toLowerCase()}`} />
        <Kpi label={t("grossProfit", lang)} value={moneyOrDash(kpis.grossProfit)} delta={profitGrowth} />
        <Kpi label={t("grossMargin", lang)} value={pct(kpis.margin, 1)}
          note={kpis.margin != null && kpis.costCoverage < 0.999
            ? `${pct(kpis.costCoverage)} ${t("ofRevenueCosted", lang)}` : undefined} />
      </div>
      <div className="stat stat-fit">
        <Kpi label={t("avgOrderValue", lang)} value={money(kpis.avgOrderValue)} />
        <Kpi label={t("deliveredRevenue", lang)} value={money(kpis.deliveredRevenue)} />
        <Kpi label={t("pendingOrders", lang)} value={String(kpis.pendingOrders)}
          note={money(kpis.pendingValue)} />
        <Kpi label={t("deliveredOrders", lang)} value={String(kpis.deliveredOrders)} />
        <Kpi label={t("cancelledOrders", lang)} value={String(kpis.cancelledOrders)}
          note={pct(kpis.cancellationRate)} />
        <Kpi label={t("onTimeDelivery", lang)} value={pct(kpis.onTimeRate)}
          note={kpis.avgFulfilmentDays != null
            ? `${kpis.avgFulfilmentDays.toFixed(1)}d ${t("avgFulfilment", lang)}` : undefined} />
      </div>

      {/* ---- 21. target vs actual ---- */}
      {target.achievement != null && (
        <div className="panel">
          <h3>{t("salesTargets", lang)} · {year}</h3>
          <div className="stat">
            <div><b>{money(target.target)}</b><span>{t("target", lang)}</span></div>
            <div><b>{money(target.actual)}</b><span>{t("actual", lang)}</span></div>
            <div><b>{money(target.remaining)}</b><span>{t("remaining", lang)}</span></div>
            <div><b>{pct(target.achievement)}</b><span>{t("achievement", lang)}</span></div>
          </div>
          <RateBar rate={Math.min(1, target.achievement)} target={1} />
        </div>
      )}

      {/* ---- 3 + 4. revenue by month, this year against last (layout row 2) ---- */}
      <div className="panel">
        <div className="panel-head">
          <h3>{t("monthlyRevenue", lang)}</h3>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <BarSeries points={monthly.map((m) => ({ label: m.label, value: m.revenue }))}
          emptyLabel={t("noDataYet", lang)} />
        {/* Growth per month against the same month last year -- the
            comparison the spec asks for, and the only one that survives a
            seasonal business. */}
        <div className="scroll-x">
          <table className="tbl tbl-compact">
            <thead>
              <tr>
                <th>{t("month", lang)}</th><th className="num">{year}</th>
                <th className="num">{year - 1}</th><th className="num">{t("growth", lang)}</th>
                <th className="num">{t("orders", lang)}</th><th className="num">{t("avgOrderValue", lang)}</th>
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
        {/* ---- 3. quarters ---- */}
        <div className="panel">
          <h3>{t("quarterlySales", lang)} · {year}</h3>
          <BarSeries points={quarterly.map((q) => ({ label: q.label, value: q.revenue }))}
            emptyLabel={t("noDataYet", lang)} />
        </div>
        {/* ---- 3. weekly, to spot peaks and quiet stretches ---- */}
        <div className="panel">
          <h3>{t("weeklySales", lang)}</h3>
          <BarSeries points={weekly.map((w) => ({ label: w.label, value: w.revenue }))}
            emptyLabel={t("noDataYet", lang)} />
        </div>
      </div>

      {/* ---- 6 + 10. category and geography (layout row 3) ---- */}
      <div className="two-col">
        <div className="panel">
          <h3>{t("salesByCategory", lang)}</h3>
          <RankedBars
            rows={byCategory.map((r) => ({
              ...r, value: r.revenue, meta: `${r.qty} ${t("units", lang)} · ${pct(r.margin)}`,
            }))}
            emptyLabel={t("noDataYet", lang)}
            onSelect={(key) => set({ categoryId: key === f.categoryId ? "" : key })} />
        </div>
        <div className="panel">
          <h3>{t("salesByMunicipality", lang)}</h3>
          <RankedBars
            rows={byMunicipality.map((r) => ({
              ...r, value: r.revenue, meta: `${r.orders} ${t("orders", lang).toLowerCase()}`,
            }))}
            emptyLabel={t("noDataYet", lang)}
            onSelect={(key) => set({ municipality: key === f.municipality ? "" : key })} />
        </div>
      </div>

      {/* ---- 5 + 8 + 18. top products and customers (layout row 4) ---- */}
      <div className="two-col">
        <div className="panel">
          <div className="panel-head">
            <h3>{t("topProducts", lang)}</h3>
            <RankPicker lang={lang} value={productRank} onChange={setProductRank} />
          </div>
          <RankedBars
            rows={rank(byProduct, productRank).map((r) => ({
              ...r,
              value: rankValue(r, productRank),
              meta: `${r.qty} ${t("units", lang)} · ${pct(r.margin)}`,
            }))}
            emptyLabel={t("noDataYet", lang)}
            format={productRank === "qty" || productRank === "orders"
              ? (n) => String(Math.round(n))
              : productRank === "margin" ? (n) => pct(n) : money}
            onSelect={(key) => set({ productId: key === f.productId ? "" : key })}
          />
        </div>
        <div className="panel">
          <div className="panel-head">
            <h3>{t("topCustomers", lang)}</h3>
            <RankPicker lang={lang} value={customerRank} onChange={setCustomerRank} />
          </div>
          <RankedBars
            rows={rank(byCustomer, customerRank).map((r) => ({
              ...r, value: rankValue(r, customerRank), meta: `${r.orders} ${t("orders", lang).toLowerCase()}`,
            }))}
            emptyLabel={t("noDataYet", lang)}
            format={customerRank === "qty" || customerRank === "orders"
              ? (n) => String(Math.round(n))
              : customerRank === "margin" ? (n) => pct(n) : money}
            onSelect={(key) => set({ customer: key === f.customer ? "" : key })}
          />
        </div>
      </div>

      {/* ---- 9 + 11. seller performance and order status (layout row 5) ---- */}
      <div className="two-col">
        <div className="panel">
          <h3>{t("sellerPerformance", lang)}</h3>
          <p className="hint">{t("sellerPerformanceNote", lang)}</p>
          <div className="scroll-x">
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th>{t("seller", lang)}</th><th className="num">{t("orders", lang)}</th>
                  <th className="num">{t("revenue", lang)}</th><th className="num">{t("qty", lang)}</th>
                  <th className="num">{t("grossProfit", lang)}</th><th className="num">{t("margin", lang)}</th>
                  <th className="num">{t("avgOrderValue", lang)}</th>
                </tr>
              </thead>
              <tbody>
                {bySeller.length ? bySeller.map((s) => (
                  <tr key={s.key}>
                    <td>{s.label}</td>
                    <td className="num">{s.orders}</td>
                    <td className="num">{money(s.revenue)}</td>
                    <td className="num">{s.qty}</td>
                    <td className="num">{moneyOrDash(s.grossProfit)}</td>
                    <td className="num">{pct(s.margin)}</td>
                    <td className="num">{money(s.orders ? s.revenue / s.orders : 0)}</td>
                  </tr>
                )) : <tr><td colSpan={7} className="hint">{t("noDataYet", lang)}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

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
      </div>

      {/* ---- payments: moved here from the old statistics page. Same
              orders, adjacent question -- with cash on delivery and `fiar`
              (credit) in the mix, "have we been paid" is a daily concern,
              not a footnote. ---- */}
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
              share: payments.byMethod.reduce((a, x) => a + x.value, 0) > 0
                ? b.value / payments.byMethod.reduce((a, x) => a + x.value, 0) : 0,
              meta: `${b.count} ${t("orders", lang).toLowerCase()}`,
            }))}
            emptyLabel={t("noDataYet", lang)}
          />
        </div>
      </div>

      {/* ---- 12 + 13. pending backlog and late deliveries (layout row 6) ---- */}
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
                    <td><Link href={`/admin/o/${o.orderId}`} className="mono">{o.ref}</Link></td>
                    <td>{o.customerName}</td>
                    <td><span className={"pill " + STATUS_PILL[o.status]}>{t("st_" + o.status, lang)}</span></td>
                    <td className="num">{money(o.revenue)}</td>
                    <td className="mono">{o.expectedDelivery || "—"}</td>
                  </tr>
                )) : <tr><td colSpan={5} className="hint">{t("nothingPending", lang)}</td></tr>}
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
                  <th>{t("expectedDelivery", lang)}</th><th className="num">{t("delayDays", lang)}</th>
                  <th className="num">{t("value", lang)}</th>
                </tr>
              </thead>
              <tbody>
                {delayed.length ? delayed.slice(0, 12).map((o) => (
                  <tr key={o.orderId}>
                    <td><Link href={`/admin/o/${o.orderId}`} className="mono">{o.ref}</Link></td>
                    <td>{o.customerName}</td>
                    <td className="mono">{o.expectedDelivery}</td>
                    <td className="num bad-text"><b>{deliveryDelayDays(o, today)}d</b></td>
                    <td className="num">{money(o.revenue)}</td>
                  </tr>
                )) : <tr><td colSpan={5} className="hint">{t("nothingDelayed", lang)}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ---- 7. customer analysis ---- */}
      <div className="panel">
        <h3>{t("customerAnalysis", lang)}</h3>
        <div className="scroll-x">
          <table className="tbl tbl-compact">
            <thead>
              <tr>
                <th>{t("customer", lang)}</th><th className="num">{t("orders", lang)}</th>
                <th className="num">{t("qty", lang)}</th><th className="num">{t("revenue", lang)}</th>
                <th className="num">{t("avgOrderValue", lang)}</th>
                <th className="num">{t("grossProfit", lang)}</th><th className="num">{t("margin", lang)}</th>
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
                    <td className="num">{moneyOrDash(c.grossProfit)}</td>
                    <td className="num">{pct(c.margin)}</td>
                    <td className="mono">{c.lastPurchase || "—"}</td>
                    <td className={"num " + (tr ? (tr.up ? "up" : "down") : "")}>{tr ? tr.text : "—"}</td>
                    <td className="num">{c.outstandingOrders ? money(c.outstandingValue) : "—"}</td>
                  </tr>
                );
              }) : <tr><td colSpan={10} className="hint">{t("noDataYet", lang)}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- 19. products that are not working ---- */}
      {weak.length > 0 && (
        <div className="panel">
          <h3>{t("lowPerformers", lang)}</h3>
          <div className="scroll-x">
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th>{t("product", lang)}</th><th className="num">{t("qty", lang)}</th>
                  <th className="num">{t("revenue", lang)}</th><th className="num">{t("margin", lang)}</th>
                  <th>{t("why", lang)}</th>
                </tr>
              </thead>
              <tbody>
                {weak.slice(0, 15).map((p) => (
                  <tr key={p.key}>
                    <td>{p.label}</td>
                    <td className="num">{p.qty}</td>
                    <td className="num">{money(p.revenue)}</td>
                    <td className="num">{pct(p.margin)}</td>
                    <td>
                      {p.reasons.map((r) => (
                        <span key={r} className="pill warn">{t("weak_" + r, lang)}</span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- 26. insights, in words ---- */}
      {insights.length > 0 && (
        <div className="panel">
          <h3>{t("salesInsights", lang)}</h3>
          <div className="insights">
            {insights.map((i) => (
              <div className="insight" key={i.kind}>
                <span>{t("insight_" + i.kind, lang)}</span>
                <b>{i.label}</b>
                <em>
                  {i.format === "money" ? money(i.value)
                    : i.format === "percent" ? pct(i.value, 1)
                      : String(i.value)}
                </em>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- 17. year on year ---- */}
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
                  <th className="num">{t("grossProfit", lang)}</th>
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
                      <td className="num">{moneyOrDash(y.grossProfit)}</td>
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

      {/* ---- 22 + 23. the detailed table, with drill-down (layout row 7) ---- */}
      <SalesTable lang={lang} lines={rows} today={today} />
    </>
  );
}

function rankValue(r: { revenue: number; qty: number; orders: number; grossProfit: number | null; margin: number | null }, by: RankBy): number {
  switch (by) {
    case "revenue": return r.revenue;
    case "qty": return r.qty;
    case "orders": return r.orders;
    case "profit": return r.grossProfit ?? 0;
    case "margin": return r.margin ?? 0;
  }
}

function RankPicker({
  lang, value, onChange,
}: { lang: Lang; value: RankBy; onChange: (v: RankBy) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as RankBy)}
      aria-label={t("rankBy", lang)}>
      <option value="revenue">{t("revenue", lang)}</option>
      <option value="qty">{t("qty", lang)}</option>
      <option value="profit">{t("grossProfit", lang)}</option>
      <option value="margin">{t("margin", lang)}</option>
      <option value="orders">{t("orders", lang)}</option>
    </select>
  );
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
