"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { RankedBars } from "../Charts";
import { money } from "@/lib/utils";
import {
  buildProductDemand, computeCatalogHealth, computeFunnel,
  demandByCategory, findDemandSignals, signalsOf,
  type DemandSignal,
} from "@/lib/demand";
import { t } from "@/lib/i18n";
import type { Category, Lang, Order, Product } from "@/lib/types";

/* The page that answers what happened BEFORE the order. The sales dashboard
 * begins at the order and cannot see any of this. */

const SIGNAL_PILL: Record<DemandSignal, string> = {
  lost_sales: "bad", views_no_sales: "warn", underexposed: "info", ignored: "muted",
};
const SIGNAL_ORDER: DemandSignal[] = [
  "lost_sales", "views_no_sales", "underexposed", "ignored",
];

function pct(n: number | null, digits = 1): string {
  return n == null ? "—" : `${(n * 100).toFixed(digits)}%`;
}

const STOCK_PILL: Record<string, string> = { in: "ok", low: "warn", out: "bad" };

export default function DemandAdmin({
  lang, products, orders, categories,
}: { lang: Lang; products: Product[]; orders: Order[]; categories: Category[] }) {
  const [signalFilter, setSignalFilter] = useState<DemandSignal | "">("");
  const [q, setQ] = useState("");

  const rows = useMemo(
    () => buildProductDemand(products, orders, categories),
    [products, orders, categories]
  );
  const funnel = useMemo(() => computeFunnel(rows), [rows]);
  const findings = useMemo(() => findDemandSignals(rows), [rows]);
  const byCategory = useMemo(() => demandByCategory(rows), [rows]);
  const health = useMemo(() => computeCatalogHealth(rows), [rows]);

  const signalFor = useMemo(() => {
    const m = new Map<string, DemandSignal>();
    for (const f of findings) m.set(f.productId, f.signal);
    return m;
  }, [findings]);

  const table = useMemo(() => {
    let a = rows;
    if (signalFilter) a = a.filter((r) => signalFor.get(r.productId) === signalFilter);
    if (q) {
      const s = q.toLowerCase();
      a = a.filter((r) => (r.name + " " + r.ref).toLowerCase().includes(s));
    }
    return a;
  }, [rows, signalFilter, signalFor, q]);

  const lostSales = signalsOf(findings, "lost_sales");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("demand", lang)}</h1>
          <p className="sub">{t("demandSub", lang)}</p>
        </div>
      </div>

      {/* The constraint, stated where it is read rather than buried in a
          tooltip: views are lifetime counters, so every rate here is
          all-time and there is deliberately no date filter. */}
      <div className="note info" style={{ marginBottom: 12 }}>{t("demandAllTimeNote", lang)}</div>

      {/* ---- the funnel ---- */}
      <div className="panel">
        <h3>{t("demandFunnel", lang)}</h3>
        <div className="funnel">
          <div className="funnel-stage">
            <b>{funnel.views.toLocaleString("en-US")}</b>
            <span>{t("views", lang)}</span>
          </div>
          <div className="funnel-arrow">
            <em>{pct(funnel.viewToClick)}</em>
            <span aria-hidden="true">→</span>
          </div>
          <div className="funnel-stage">
            <b>{funnel.waClicks.toLocaleString("en-US")}</b>
            <span>{t("waClicks", lang)}</span>
          </div>
          <div className="funnel-arrow">
            <em>{pct(funnel.clickToOrder)}</em>
            <span aria-hidden="true">→</span>
          </div>
          <div className="funnel-stage">
            <b>{funnel.orders.toLocaleString("en-US")}</b>
            <span>{t("orders", lang)}</span>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          {t("overallConversion", lang)}: <b>{pct(funnel.viewToOrder, 2)}</b>
        </p>
      </div>

      {/* ---- lost sales first: the only signal that is costing money right
              now, and the only one with an obvious action ---- */}
      {lostSales.length > 0 && (
        <div className="alerts">
          <div className="alert alert-high">
            <b>{t("signal_lost_sales", lang)}</b>
            <span>
              {lostSales.length} · {lostSales.reduce((a, r) => a + r.views, 0).toLocaleString("en-US")} {t("views", lang).toLowerCase()}
            </span>
          </div>
        </div>
      )}

      {/* ---- signal tiles, each one a filter on the table below ---- */}
      <div className="status-tiles">
        {SIGNAL_ORDER.map((s) => {
          const hits = signalsOf(findings, s);
          return (
            <button key={s} type="button"
              className={"status-tile" + (signalFilter === s ? " is-on" : "")}
              onClick={() => setSignalFilter(signalFilter === s ? "" : s)}>
              <b>{hits.length}</b>
              <span>{t("signal_" + s, lang)}</span>
              <em>{t("signalHint_" + s, lang)}</em>
            </button>
          );
        })}
      </div>

      <div className="two-col">
        {/* ---- where attention goes ---- */}
        <div className="panel">
          <h3>{t("attentionByCategory", lang)}</h3>
          <RankedBars
            rows={byCategory.map((c) => ({
              key: c.key, label: c.label, value: c.views, share: c.viewShare,
              meta: `${c.products} ${t("products", lang).toLowerCase()} · ${pct(c.viewToOrder, 2)} ${t("conversion", lang).toLowerCase()}`,
            }))}
            emptyLabel={t("noDataYet", lang)}
            format={(n) => n.toLocaleString("en-US")}
          />
        </div>

        {/* ---- listing problems that suppress demand before any shopper
                is involved ---- */}
        <div className="panel">
          <h3>{t("catalogHealth", lang)}</h3>
          <div className="stat stat-fit">
            <div><b>{health.live}</b><span>{t("liveProducts", lang)}</span></div>
            <div><b>{health.outOfStock}</b><span>{t("outOfStock", lang)}</span></div>
            <div><b>{health.lowStock}</b><span>{t("stockLow", lang)}</span></div>
            <div><b>{health.neverViewed}</b><span>{t("neverViewed", lang)}</span></div>
            <div><b>{health.noImage}</b><span>{t("noImage", lang)}</span></div>
            <div><b>{health.uncategorised}</b><span>{t("uncategorised", lang)}</span></div>
          </div>
        </div>
      </div>

      {/* ---- every product, most-looked-at first ---- */}
      <div className="panel">
        <div className="panel-head">
          <h3>{t("productDemand", lang)}</h3>
          <div className="bar" style={{ margin: 0 }}>
            <input type="search" placeholder={t("search", lang)} value={q}
              onChange={(e) => setQ(e.target.value)} style={{ minWidth: 150 }} />
            {signalFilter && (
              <button type="button" className="btn btn-sm btn-ghost"
                onClick={() => setSignalFilter("")}>{t("clearFilters", lang)}</button>
            )}
          </div>
        </div>

        <div className="scroll-x">
          <table className="tbl tbl-compact">
            <thead>
              <tr>
                <th>{t("product", lang)}</th>
                <th>{t("ref", lang)}</th>
                <th className="num">{t("views", lang)}</th>
                <th className="num">{t("waClicks", lang)}</th>
                <th className="num">{t("orders", lang)}</th>
                <th className="num">{t("conversion", lang)}</th>
                <th className="num">{t("revenue", lang)}</th>
                <th>{t("stock", lang)}</th>
                <th>{t("signal", lang)}</th>
              </tr>
            </thead>
            <tbody>
              {table.length ? table.map((r) => {
                const sig = signalFor.get(r.productId);
                return (
                  <tr key={r.productId}>
                    <td><Link href={`/admin/p/${r.productId}`}>{r.name}</Link></td>
                    <td className="mono">{r.ref}</td>
                    <td className="num">{r.views.toLocaleString("en-US")}</td>
                    <td className="num">{r.waClicks.toLocaleString("en-US")}</td>
                    <td className="num">{r.orders}</td>
                    <td className="num">{pct(r.viewToOrder, 2)}</td>
                    <td className="num">{money(r.revenue)}</td>
                    <td>
                      <span className={"pill " + STOCK_PILL[r.stockStatus]}>
                        {t("stock" + r.stockStatus.charAt(0).toUpperCase() + r.stockStatus.slice(1), lang)}
                      </span>
                    </td>
                    <td>
                      {sig && <span className={"pill " + SIGNAL_PILL[sig]}>{t("signal_" + sig, lang)}</span>}
                    </td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={9} className="hint">{t("noResults", lang)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
