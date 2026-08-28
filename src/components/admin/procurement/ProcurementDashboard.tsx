"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { BarSeries, RankedBars, RateBar } from "../Charts";
import { countryFlag, countryName, PO_CURRENCIES, SOURCING_COUNTRIES } from "@/lib/countries";
import { money } from "@/lib/utils";
import {
  buildAlerts, computeKpis, deliveryState, filterPurchaseOrders, growth, isOpen,
  poDaysRemaining, poDelayDays, poQty, poTotal, spendByCategory,
  spendByCountry, spendByMonth, spendByProduct, spendBySupplier, statusBreakdown,
  supplierPerformance, todayIso, PO_STATUSES,
  type ProcurementFilter,
} from "@/lib/procurement";
import { t } from "@/lib/i18n";
import type {
  Lang, PoCategory, PoPaymentStatus, PoStatus, PurchaseOrder, Supplier,
} from "@/lib/types";

const CATEGORIES: PoCategory[] = [
  "raw_materials", "components", "packaging", "office", "equipment", "services", "other",
];
const PAYMENT_STATUSES: PoPaymentStatus[] = ["unpaid", "partial", "paid", "overdue"];

/** Colour per delivery state. Semantic, and separate from the brand accent:
 * green/amber/red/blue here mean "on time / due / late / moving", nothing
 * about the store's identity. */
const STATE_PILL: Record<string, string> = {
  received: "ok", on_time: "ok", due_soon: "warn",
  delayed: "bad", in_transit: "info", cancelled: "muted", open: "muted",
};

function pct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}
function days(n: number | null): string {
  return n == null ? "—" : `${Math.round(n)}d`;
}
/** Signed, so a rise in spend and a rise in delays read differently at a
 * glance even though both are "up". */
function delta(n: number | null): { text: string; up: boolean } | null {
  if (n == null) return null;
  return { text: `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`, up: n >= 0 };
}

export default function ProcurementDashboard({
  lang, suppliers, purchaseOrders,
}: { lang: Lang; suppliers: Supplier[]; purchaseOrders: PurchaseOrder[] }) {
  const today = todayIso();
  const thisYear = Number(today.slice(0, 4));

  const [f, setF] = useState<ProcurementFilter>({});
  const [year, setYear] = useState(thisYear);
  const set = (patch: Partial<ProcurementFilter>) => setF((s) => ({ ...s, ...patch }));
  const clear = () => setF({});

  const supplierById = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s])), [suppliers]
  );

  // One filtered set feeds every KPI, chart and table on the page, so a
  // filter can never apply to some panels and not others.
  const rows = useMemo(
    () => filterPurchaseOrders(purchaseOrders, suppliers, f),
    [purchaseOrders, suppliers, f]
  );

  const kpis = useMemo(() => computeKpis(rows, suppliers, today), [rows, suppliers, today]);

  // Previous year on the same filters, purely to give the KPI cards something
  // honest to compare against.
  const prevKpis = useMemo(() => {
    const prev = filterPurchaseOrders(purchaseOrders, suppliers, {
      ...f, from: `${year - 1}-01-01`, to: `${year - 1}-12-31`,
    });
    return computeKpis(prev, suppliers, today);
  }, [purchaseOrders, suppliers, f, year, today]);

  const yearRows = useMemo(
    () => rows.filter((p) => p.order_date.slice(0, 4) === String(year)),
    [rows, year]
  );
  const monthly = useMemo(
    () => spendByMonth(yearRows, `${year}-01-01`, `${year}-12-31`),
    [yearRows, year]
  );

  const bySupplier = useMemo(() => spendBySupplier(rows, suppliers), [rows, suppliers]);
  const byCountry = useMemo(
    () => spendByCountry(rows, suppliers, countryName), [rows, suppliers]
  );
  const byCategory = useMemo(() => spendByCategory(rows), [rows]);
  const byProduct = useMemo(() => spendByProduct(rows, suppliers), [rows, suppliers]);
  const perf = useMemo(() => supplierPerformance(rows, suppliers, today), [rows, suppliers, today]);
  const statuses = useMemo(() => statusBreakdown(rows), [rows]);
  const alerts = useMemo(() => buildAlerts(rows, suppliers, today), [rows, suppliers, today]);

  const [arrivalWindow, setArrivalWindow] = useState(7);
  const upcoming = useMemo(() => rows
    .filter((p) => {
      if (!isOpen(p)) return false;
      const left = poDaysRemaining(p, today);
      return left != null && left >= 0 && left <= arrivalWindow;
    })
    .sort((a, b) => (a.expected_arrival || "").localeCompare(b.expected_arrival || "")),
    [rows, today, arrivalWindow]);

  const delayed = useMemo(() => rows
    .filter((p) => poDelayDays(p, today) > 0)
    .sort((a, b) => poDelayDays(b, today) - poDelayDays(a, today)),
    [rows, today]);

  const buyers = useMemo(
    () => [...new Set(purchaseOrders.map((p) => p.buyer).filter(Boolean))].sort(),
    [purchaseOrders]
  );
  const years = useMemo(() => {
    const ys = [...new Set(purchaseOrders.map((p) => Number(p.order_date.slice(0, 4))))];
    return (ys.length ? ys : [thisYear]).sort((a, b) => b - a);
  }, [purchaseOrders, thisYear]);

  const filtersActive = Object.values(f).some((v) => v !== undefined && v !== "");
  const valueGrowth = delta(growth(kpis.totalValue, prevKpis.totalValue));

  const supplierName = (id: string) => supplierById.get(id)?.name || "—";
  const supplierCountry = (id: string) => supplierById.get(id)?.country_code || "";

  return (
    <>
      <h1>{t("procurement", lang)}</h1>
      <p className="sub">{t("procurementSub", lang)}</p>

      {/* ---- alerts: the things needing a decision, above everything else ---- */}
      {alerts.length > 0 && (
        <div className="alerts">
          {alerts.map((a, i) => (
            <div key={a.kind + i} className={"alert alert-" + a.severity}>
              <b>{t("alert_" + a.kind, lang)}</b>
              <span>
                {a.kind === "supplier_underperforming"
                  ? `${a.label} — ${pct(a.value ?? null)} ${t("onTimeRate", lang).toLowerCase()}`
                  : `${a.count} ${t("purchaseOrders", lang).toLowerCase()}` +
                    (a.value != null ? ` · ${money(a.value)}` : "")}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ---- global filters: every panel below reads the same filtered set ---- */}
      <div className="panel filters">
        <h3>{t("filters", lang)}</h3>
        <div className="filter-grid">
          <label><span>{t("fromDate", lang)}</span>
            <input type="date" value={f.from || ""} onChange={(e) => set({ from: e.target.value })} /></label>
          <label><span>{t("toDate", lang)}</span>
            <input type="date" value={f.to || ""} onChange={(e) => set({ to: e.target.value })} /></label>
          <label><span>{t("supplier", lang)}</span>
            <select value={f.supplierId || ""} onChange={(e) => set({ supplierId: e.target.value })}>
              <option value="">{t("all", lang)}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          <label><span>{t("country", lang)}</span>
            <select value={f.countryCode || ""} onChange={(e) => set({ countryCode: e.target.value })}>
              <option value="">{t("all", lang)}</option>
              {SOURCING_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
              ))}
            </select></label>
          <label><span>{t("category", lang)}</span>
            <select value={f.category || ""} onChange={(e) => set({ category: e.target.value as PoCategory })}>
              <option value="">{t("all", lang)}</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t("cat_" + c, lang)}</option>)}
            </select></label>
          <label><span>{t("purchaseStatus", lang)}</span>
            <select value={f.status || ""} onChange={(e) => set({ status: e.target.value as PoStatus })}>
              <option value="">{t("all", lang)}</option>
              {PO_STATUSES.map((s) => <option key={s} value={s}>{t("po_" + s, lang)}</option>)}
            </select></label>
          <label><span>{t("paymentStatus", lang)}</span>
            <select value={f.paymentStatus || ""}
              onChange={(e) => set({ paymentStatus: e.target.value as PoPaymentStatus })}>
              <option value="">{t("all", lang)}</option>
              {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{t("pay_" + s, lang)}</option>)}
            </select></label>
          <label><span>{t("buyer", lang)}</span>
            <select value={f.buyer || ""} onChange={(e) => set({ buyer: e.target.value })}>
              <option value="">{t("all", lang)}</option>
              {buyers.map((b) => <option key={b} value={b}>{b}</option>)}
            </select></label>
          <label><span>{t("currency", lang)}</span>
            <select value={f.currency || ""} onChange={(e) => set({ currency: e.target.value })}>
              <option value="">{t("all", lang)}</option>
              {PO_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select></label>
          <label className="filter-search"><span>{t("search", lang)}</span>
            <input type="text" value={f.q || ""} placeholder={t("searchPoHint", lang)}
              onChange={(e) => set({ q: e.target.value })} /></label>
        </div>
        {filtersActive && (
          <button className="btn btn-sm btn-ghost" type="button" onClick={clear}
            style={{ marginTop: 8 }}>{t("clearFilters", lang)}</button>
        )}
      </div>

      {/* ---- row 1: KPI cards ---- */}
      <div className="stat stat-fit">
        <div>
          <b>{money(kpis.totalValue)}</b><span>{t("totalPurchaseValue", lang)}</span>
          {valueGrowth && (
            <em className={"kpi-delta " + (valueGrowth.up ? "up" : "down")}>
              {valueGrowth.text} {t("vsPrevYear", lang)}
            </em>
          )}
        </div>
        <div><b>{kpis.orderCount}</b><span>{t("purchaseOrders", lang)}</span></div>
        <div><b>{kpis.totalQty.toLocaleString()}</b><span>{t("quantityPurchased", lang)}</span></div>
        <div><b>{kpis.supplierCount}</b><span>{t("suppliers", lang)}</span></div>
        <div><b>{kpis.countryCount}</b><span>{t("countries", lang)}</span></div>
        <div><b>{kpis.pendingOrders}</b><span>{t("pendingOrders", lang)}</span></div>
        <div><b>{kpis.inTransitOrders}</b><span>{t("po_in_transit", lang)}</span></div>
        <div><b>{kpis.receivedOrders}</b><span>{t("po_received", lang)}</span></div>
        <div>
          <b style={{ color: kpis.delayedOrders ? "var(--red)" : undefined }}>{kpis.delayedOrders}</b>
          <span>{t("delayedOrders", lang)}</span>
          {kpis.delayedValue > 0 && <em className="kpi-delta down">{money(kpis.delayedValue)}</em>}
        </div>
        <div><b>{days(kpis.avgDeliveryDays)}</b><span>{t("avgDeliveryTime", lang)}</span></div>
        <div><b>{pct(kpis.onTimeRate)}</b><span>{t("onTimeRate", lang)}</span></div>
        <div><b>{money(kpis.outstandingValue)}</b><span>{t("outstandingValue", lang)}</span></div>
      </div>

      {/* ---- row 2: monthly spend | spend by supplier ---- */}
      <div className="two-col">
        <div className="panel">
          <div className="panel-head">
            <h3>{t("monthlyPurchaseValue", lang)}</h3>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <BarSeries
            points={monthly.map((m) => ({ label: m.month.slice(5), value: m.value }))}
            emptyLabel={t("noDataYet", lang)}
          />
        </div>
        <div className="panel">
          <h3>{t("valueBySupplier", lang)}</h3>
          <RankedBars
            rows={bySupplier.map((r) => ({
              key: r.key, label: r.label, value: r.value, share: r.share,
              meta: `${r.orders} ${t("purchaseOrders", lang).toLowerCase()}`,
            }))}
            emptyLabel={t("noDataYet", lang)}
            onSelect={(key) => set({ supplierId: key })}
          />
        </div>
      </div>

      {/* ---- row 3: spend by country | quantity by category ---- */}
      <div className="two-col">
        <div className="panel">
          <h3>{t("valueByCountry", lang)}</h3>
          <RankedBars
            rows={byCountry.map((r) => ({
              key: r.key, label: `${countryFlag(r.key)} ${r.label}`, value: r.value, share: r.share,
              meta: `${r.suppliers} ${t("suppliers", lang).toLowerCase()} · ${days(r.avgDeliveryDays)}`,
            }))}
            emptyLabel={t("noDataYet", lang)}
            onSelect={(key) => set({ countryCode: key === "??" ? "" : key })}
          />
        </div>
        <div className="panel">
          <h3>{t("quantityByCategory", lang)}</h3>
          <RankedBars
            rows={byCategory.map((r) => ({
              key: r.category, label: t("cat_" + r.category, lang), value: r.qty,
              share: r.share, meta: money(r.value),
            }))}
            emptyLabel={t("noDataYet", lang)}
            format={(n) => n.toLocaleString()}
            onSelect={(key) => set({ category: key as PoCategory })}
          />
        </div>
      </div>

      {/* ---- row 4: upcoming arrivals | delayed ---- */}
      <div className="two-col">
        <div className="panel">
          <div className="panel-head">
            <h3>{t("upcomingArrivals", lang)}</h3>
            <select value={arrivalWindow} onChange={(e) => setArrivalWindow(Number(e.target.value))}>
              {[7, 15, 30].map((d) => (
                <option key={d} value={d}>{t("nextNDays", lang).replace("{n}", String(d))}</option>
              ))}
            </select>
          </div>
          {!upcoming.length ? <p className="hint">{t("nothingArriving", lang)}</p> : (
            <div className="scroll-x"><table className="tbl tbl-compact"><tbody>
              {upcoming.map((p) => {
                const left = poDaysRemaining(p, today) ?? 0;
                return (
                  <tr key={p.id}>
                    <td><Link className="mono" href={`/admin/procurement/po/${p.id}`}>{p.po_number}</Link></td>
                    <td>{supplierName(p.supplier_id)}</td>
                    <td className="num">{poQty(p).toLocaleString()}</td>
                    <td className="num">{money(poTotal(p))}</td>
                    <td className="num"><span className={"pill " + (left <= 3 ? "warn" : "info")}>{left}d</span></td>
                  </tr>
                );
              })}
            </tbody></table></div>
          )}
        </div>
        <div className="panel">
          <h3>{t("delayedOrders", lang)}
            {delayed.length > 0 && <span className="pill bad" style={{ marginLeft: 8 }}>
              {money(delayed.reduce((a, p) => a + poTotal(p), 0))}</span>}
          </h3>
          {!delayed.length ? <p className="hint">{t("nothingDelayed", lang)}</p> : (
            <div className="scroll-x"><table className="tbl tbl-compact"><tbody>
              {delayed.map((p) => (
                <tr key={p.id}>
                  <td><Link className="mono" href={`/admin/procurement/po/${p.id}`}>{p.po_number}</Link></td>
                  <td>{supplierName(p.supplier_id)}</td>
                  <td>{countryFlag(supplierCountry(p.supplier_id))}</td>
                  <td className="num">{money(poTotal(p))}</td>
                  <td className="num"><span className="pill bad">+{poDelayDays(p, today)}d</span></td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        </div>
      </div>

      {/* ---- row 5: supplier performance | status breakdown ---- */}
      <div className="two-col">
        <div className="panel">
          <h3>{t("supplierPerformance", lang)}</h3>
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr>
                <th>{t("supplier", lang)}</th>
                <th className="num">{t("score", lang)}</th>
                <th className="num">{t("purchaseOrders", lang)}</th>
                <th className="num">{t("value", lang)}</th>
                <th className="num">{t("avgDeliveryTime", lang)}</th>
                <th className="num">{t("onTimeRate", lang)}</th>
                <th className="num">{t("delayedOrders", lang)}</th>
              </tr></thead>
              <tbody>
                {perf.filter((p) => p.orders > 0).map((p) => (
                  <tr key={p.supplier.id}>
                    <td>
                      <button type="button" className="linkish"
                        onClick={() => set({ supplierId: p.supplier.id })}>
                        {countryFlag(p.supplier.country_code)} {p.supplier.name}
                      </button>
                    </td>
                    <td className="num">
                      {/* Unrated rather than a misleading number: a supplier
                          with nothing delivered has not earned a score. */}
                      {p.onTimeRate == null
                        ? <span className="hint">{t("unrated", lang)}</span>
                        : <b className={p.score >= 70 ? "score-ok" : p.score >= 45 ? "score-mid" : "score-bad"}>{p.score}</b>}
                    </td>
                    <td className="num">{p.orders}</td>
                    <td className="num">{money(p.value)}</td>
                    <td className="num">{days(p.avgDeliveryDays)}</td>
                    <td className="num"><RateBar rate={p.onTimeRate} /></td>
                    <td className="num">{p.delayedOrders || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <h3>{t("orderStatus", lang)}</h3>
          <div className="status-grid">
            {statuses.filter((s) => s.count > 0).map((s) => (
              <button key={s.status} type="button"
                className={"status-cell" + (f.status === s.status ? " is-on" : "")}
                onClick={() => set({ status: f.status === s.status ? "" : s.status })}>
                <b>{s.count}</b>
                <span>{t("po_" + s.status, lang)}</span>
                <em>{money(s.value)}</em>
              </button>
            ))}
            {statuses.every((s) => s.count === 0) && <p className="hint">{t("noDataYet", lang)}</p>}
          </div>
        </div>
      </div>

      {/* ---- products ---- */}
      <div className="panel">
        <h3>{t("productAnalysis", lang)}</h3>
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr>
              <th>{t("product", lang)}</th>
              <th>{t("category", lang)}</th>
              <th className="num">{t("quantity", lang)}</th>
              <th className="num">{t("value", lang)}</th>
              <th className="num">{t("avgUnitPrice", lang)}</th>
              <th className="num">{t("purchaseOrders", lang)}</th>
              <th>{t("mainSupplier", lang)}</th>
              <th className="num">{t("lastPurchase", lang)}</th>
            </tr></thead>
            <tbody>
              {byProduct.slice(0, 25).map((p) => (
                <tr key={p.name}>
                  <td><b>{p.name}</b></td>
                  <td>{t("cat_" + p.category, lang)}</td>
                  <td className="num">{p.qty.toLocaleString()}</td>
                  <td className="num">{money(p.value)}</td>
                  <td className="num">{money(p.avgUnitPrice)}</td>
                  <td className="num">{p.orders}</td>
                  <td>{p.mainSupplier}</td>
                  <td className="num">{p.lastPurchase || "—"}</td>
                </tr>
              ))}
              {!byProduct.length && (
                <tr><td colSpan={8}><p className="hint" style={{ margin: 0 }}>{t("noDataYet", lang)}</p></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- row 6: the full purchase order table ---- */}
      <div className="panel">
        <div className="panel-head">
          <h3>{t("purchaseOrders", lang)} <span className="hint">({rows.length})</span></h3>
          <Link className="btn btn-sm btn-amber" href="/admin/procurement/po/new">
            + {t("newPurchaseOrder", lang)}
          </Link>
        </div>
        <div className="scroll-x">
          <table className="tbl">
            <thead><tr>
              <th>{t("poNumber", lang)}</th>
              <th className="num">{t("purchaseDate", lang)}</th>
              <th>{t("supplier", lang)}</th>
              <th>{t("country", lang)}</th>
              <th className="num">{t("quantity", lang)}</th>
              <th className="num">{t("value", lang)}</th>
              <th>{t("purchaseStatus", lang)}</th>
              <th>{t("paymentStatus", lang)}</th>
              <th className="num">{t("expectedArrival", lang)}</th>
              <th className="num">{t("deliveryStatus", lang)}</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => {
                const state = deliveryState(p, today);
                const late = poDelayDays(p, today);
                return (
                  <tr key={p.id}>
                    <td><Link className="mono" href={`/admin/procurement/po/${p.id}`}>{p.po_number}</Link></td>
                    <td className="num">{p.order_date}</td>
                    <td>{supplierName(p.supplier_id)}</td>
                    <td>{countryFlag(supplierCountry(p.supplier_id))} {countryName(supplierCountry(p.supplier_id))}</td>
                    <td className="num">{poQty(p).toLocaleString()}</td>
                    <td className="num">
                      {money(poTotal(p))}
                      {/* The original currency is kept beside the converted
                          figure: a buyer checking an invoice needs the number
                          the supplier actually billed. */}
                      {p.currency !== "USD" && <span className="stock-sub">{p.currency}</span>}
                    </td>
                    <td><span className="pill">{t("po_" + p.status, lang)}</span></td>
                    <td><span className={"pill " + (p.payment_status === "overdue" ? "bad" :
                      p.payment_status === "paid" ? "ok" : "warn")}>
                      {t("pay_" + p.payment_status, lang)}</span></td>
                    <td className="num">{p.expected_arrival || "—"}</td>
                    <td className="num">
                      <span className={"pill " + STATE_PILL[state]}>
                        {t("state_" + state, lang)}{late > 0 ? ` +${late}d` : ""}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={10}><p className="hint" style={{ margin: 0 }}>{t("noResults", lang)}</p></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
