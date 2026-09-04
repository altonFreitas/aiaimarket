"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { DualLine } from "./Charts";
import { money } from "@/lib/utils";
import {
  overviewSeries, headlineMetrics, buildOverviewInsights, periodShape,
  purchasesResolvable, rangeSpec, METRIC_KEYS, RANGES,
  type MetricKey, type MetricRow, type PeriodPoint, type RangeKey,
} from "@/lib/overview";
import { unpackSalesLines, type PackedSalesLines } from "@/lib/salesWire";
import { t } from "@/lib/i18n";
import type { Lang, PurchaseOrder } from "@/lib/types";

/* Is the business getting better or worse?
 *
 * Six numbers, two charts and a short paragraph. Everything else -- who
 * bought what, which supplier is late, which category grew -- is on the two
 * dashboards this links to, and is deliberately not repeated. This screen
 * only does the thing neither of them can: put the two sides on one
 * timeline.
 *
 * WHAT THE COMPARISONS MEAN, because a percentage with an unstated basis is
 * worse than no percentage. Four days into a month, both figures compare
 * the 1st to the 4th against the 1st to the 4th of the month before and of
 * the same month last year. Comparing a part-month against a whole one
 * reports a healthy business as collapsing, every month, for most of the
 * month. The subtitle says which basis is in use. */

const METRIC_LABEL: Record<MetricKey, string> = {
  revenue: "totalSalesRevenue",
  purchaseCost: "totalPurchaseValue",
  qtySold: "quantitySold",
  qtyPurchased: "quantityPurchased",
  grossProfit: "grossProfit",
  ratio: "salesToPurchaseRatio",
};

/** Which way is good. Spending more is not bad on its own -- a growing shop
 * buys more -- so purchases and the ratio are reported without a verdict,
 * and the written summary below judges them against sales growth instead. */
const JUDGED: ReadonlySet<MetricKey> = new Set(["revenue", "qtySold", "grossProfit"]);

function pct(n: number | null): string {
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
}

function Delta({ label, value, judged }: {
  label: string; value: number | null; judged: boolean;
}) {
  if (value == null) return <em className="kpi-delta hint">{label} —</em>;
  const cls = !judged ? "" : value >= 0 ? " up" : " down";
  return <em className={"kpi-delta" + cls}>{pct(value)} {label}</em>;
}

export default function BusinessOverview({
  lang, lines: wire, purchases, today, canSales, canProcurement,
  topCustomer, topSupplier,
}: {
  lang: Lang;
  lines: PackedSalesLines;
  purchases: PurchaseOrder[];
  today: string;
  canSales: boolean;
  canProcurement: boolean;
  topCustomer: { label: string; value: number } | null;
  topSupplier: { label: string; value: number } | null;
}) {
  const lines = useMemo(() => unpackSalesLines(wire), [wire]);
  /* One month by default: long enough to show a shape, short enough that
     every bar of it is this month's business. */
  const [range, setRange] = useState<RangeKey>("1m");
  const spec = rangeSpec(range);

  const points: PeriodPoint[] = useMemo(
    () => overviewSeries(lines, purchases, range, today),
    [lines, purchases, range, today]);

  const metrics = useMemo(
    () => headlineMetrics(lines, purchases, today), [lines, purchases, today]);
  const shape = useMemo(() => periodShape(today), [today]);

  const insights = useMemo(() => buildOverviewInsights({
    metrics, topCustomer, topSupplier, money,
  }), [metrics, topCustomer, topSupplier]);

  const byKey = (k: MetricKey): MetricRow | undefined => metrics.find((m) => m.key === k);

  // Only the metrics this account can actually see the source of. A staff
  // member holding Sales and not Procurement gets the sales half and no
  // purchase figures -- not a screen of dashes.
  const shownKeys = METRIC_KEYS.filter((k) => {
    if (k === "revenue" || k === "qtySold" || k === "grossProfit") return canSales;
    if (k === "purchaseCost" || k === "qtyPurchased") return canProcurement;
    return canSales && canProcurement;
  });

  /* Whether the BUSINESS has any history -- not whether the range picked
   * does. Asking the selected range was what made the chart disappear on
   * 1D: a shop that has not sold anything yet today would lose the whole
   * panel, tabs and all, and there is then no way back to 1M except
   * reloading. The panel stays; a quiet range draws a flat line and says
   * so. */
  const hasHistory = lines.length > 0 || purchases.length > 0;
  const bothSides = canSales && canProcurement;
  /* Purchase orders carry a date and no time, so there is nothing to draw
     by the hour. Not a gap to interpolate -- the information does not
     exist, and a flat line at zero would be read as "we bought nothing". */
  const showPurchases = bothSides && purchasesResolvable(spec.bucket);

  const fmtMoney = (n: number) => money(n);
  const fmtUnits = (n: number) => String(Math.round(n));

  const value = (row: MetricRow | undefined): string => {
    if (!row || row.current == null) return "—";
    switch (row.key) {
      case "revenue": case "purchaseCost": case "grossProfit": return money(row.current);
      case "ratio": return row.current.toFixed(2) + "×";
      default: return String(Math.round(row.current));
    }
  };

  return (
    <>
      <div className="panel-head ov-head">
        <div>
          <h2>{t("ovTitle", lang)}</h2>
          <p className="sub">
            {shape.complete
              ? t("ovBasisWhole", lang)
              : t("ovBasisPartial", lang).replace("{d}", String(shape.dayOfMonth))}
          </p>
        </div>
      </div>

      {/* ---- the six numbers, each with both comparisons ---- */}
      <div className="stat stat-fit">
        {shownKeys.map((k) => {
          const row = byKey(k);
          const judged = JUDGED.has(k);
          return (
            <div key={k}>
              <b>{value(row)}</b>
              <span>{t(METRIC_LABEL[k], lang)}</span>
              <Delta label={t("mom", lang)} value={row?.mom?.pct ?? null} judged={judged} />
              <Delta label={t("yoy", lang)} value={row?.yoy?.pct ?? null} judged={judged} />
            </div>
          );
        })}
      </div>

      {/* ---- the two trends ---- */}
      {hasHistory && (
        <div className="panel">
          <div className="panel-head">
            {/* Titled by what is actually drawn. On the intraday range the
                purchase series is absent, and calling that chart "money in
                against money out" would promise a comparison it is not
                making. */}
            <h3>{showPurchases ? t("ovMoneyTrend", lang) : t("totalSalesRevenue", lang)}</h3>
            {/* One control for both charts. The bucket comes with the
                range rather than being a second picker: a day is read in
                hours, a month in days, a year in months, and nobody can
                ask for five years by the hour. */}
            <div className="bar preset-bar" style={{ margin: 0 }}>
              {RANGES.map((r) => (
                <button key={r.key} type="button"
                  className={"chip" + (range === r.key ? " is-on" : "")}
                  onClick={() => setRange(r.key)}>
                  {t("rng_" + r.key, lang)}
                </button>
              ))}
            </div>
          </div>
          <DualLine
            points={points.map((p) => ({
              label: p.label, full: p.full, a: p.revenue,
              b: showPurchases ? p.purchaseCost : null,
            }))}
            labelA={t("totalSalesRevenue", lang)}
            labelB={t("totalPurchaseValue", lang)}
            emptyLabel={t("ovNothingInRange", lang)}
            format={fmtMoney}
            note={showPurchases ? undefined : t("ovNoIntradayPurchases", lang)}
          />
          {/* The table view the contrast check obliges, and the thing a
              chart cannot do: exact figures, and the difference between
              them stated rather than measured off two lines by eye. */}
          <div className="scroll-x">
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th>{t("bkt_" + spec.bucket, lang)}</th>
                  <th className="num">{t("totalSalesRevenue", lang)}</th>
                  {showPurchases && <th className="num">{t("totalPurchaseValue", lang)}</th>}
                  {showPurchases && <th className="num">{t("difference", lang)}</th>}
                </tr>
              </thead>
              <tbody>
                {points.slice(-12).map((p) => (
                  <tr key={p.key}>
                    <td className="mono ov-period">{p.full}</td>
                    <td className="num">{money(p.revenue)}</td>
                    {showPurchases && <td className="num">{money(p.purchaseCost)}</td>}
                    {showPurchases && (
                      <td className={"num " + (p.revenue - p.purchaseCost >= 0 ? "up" : "down")}>
                        {money(p.revenue - p.purchaseCost)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasHistory && bothSides && (
        <div className="panel">
          <h3>{showPurchases ? t("ovStockTrend", lang) : t("quantitySold", lang)}</h3>
          <p className="hint" style={{ marginTop: -6 }}>{t("ovStockTrendHint", lang)}</p>
          <DualLine
            points={points.map((p) => ({
              label: p.label, full: p.full, a: p.qtySold,
              b: showPurchases ? p.qtyPurchased : null,
            }))}
            labelA={t("quantitySold", lang)}
            labelB={t("quantityPurchased", lang)}
            emptyLabel={t("ovNothingInRange", lang)}
            format={fmtUnits}
            note={showPurchases ? undefined : t("ovNoIntradayPurchases", lang)}
          />
        </div>
      )}

      {/* ---- what it adds up to, in sentences ---- */}
      {insights.length > 0 && (
        <div className="panel">
          <h3>{t("ovSummary", lang)}</h3>
          <ul className="ov-insights">
            {insights.map((i) => (
              <li key={i.kind} className={"ov-insight ov-" + i.tone}>
                {fill(t("ovi_" + i.kind, lang), i.vars)}
              </li>
            ))}
          </ul>
          {/* Where the detail is. This screen deliberately does not carry
              the breakdowns; it says which door to open for them. */}
          <div className="attn-links">
            {canSales && (
              <Link className="btn btn-sm btn-ghost" href="/admin/sales">
                {t("salesDashboard", lang)}
              </Link>
            )}
            {canProcurement && (
              <Link className="btn btn-sm btn-ghost" href="/admin/procurement">
                {t("procurement", lang)}
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}
