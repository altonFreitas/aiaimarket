"use client";
import { useState } from "react";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { DailyPoint, PeriodPoint } from "@/lib/stats";
import type { Lang } from "@/lib/types";

type Period = "day" | "month" | "quarter" | "year";
type ChartType = "bar" | "line";
const CHART_H = 140;

export default function TrendChart({
  lang, metric, daily, monthly, quarterly, yearly,
}: {
  lang: Lang;
  metric: "revenue" | "qty";
  daily: DailyPoint[];
  monthly: PeriodPoint[];
  quarterly: PeriodPoint[];
  yearly: PeriodPoint[];
}) {
  const [period, setPeriod] = useState<Period>("day");
  const [chartType, setChartType] = useState<ChartType>("bar"); // bar is the default, per request
  const [selected, setSelected] = useState<number | null>(null);

  const source =
    period === "day" ? daily :
    period === "month" ? monthly :
    period === "quarter" ? quarterly :
    yearly;

  // Trim leading periods with zero orders — no point showing 13 empty
  // days before the first sale. Only trims the start; today's edge stays
  // even if nothing has sold yet today.
  const firstActive = source.findIndex((p) => p.orders > 0);
  const trimmed = firstActive === -1 ? source : source.slice(firstActive);

  const raw =
    period === "day" ? (trimmed as typeof daily).map((d) => ({ label: d.date.slice(5), value: d[metric], subtotal: d.subtotal, fee: d.fee })) :
    (trimmed as typeof monthly).map((m) => ({ label: period === "month" ? m.label.slice(2) : m.label, value: m[metric], subtotal: m.subtotal, fee: m.fee }));

  const hasAnyData = firstActive !== -1;
  const max = Math.max(1, ...raw.map((p) => p.value));
  const periodTotal = raw.reduce((a, p) => a + p.value, 0);
  const periodSubtotal = raw.reduce((a, p) => a + p.subtotal, 0);
  const periodFee = raw.reduce((a, p) => a + p.fee, 0);
  const format = (v: number) => (metric === "revenue" ? money(v) : String(v));

  // "$46.00 = $45.00 products + $1.00 fee" — only meaningful for the
  // revenue chart; units sold has no fee/subtotal split.
  function breakdown(subtotal: number, fee: number): string {
    if (metric !== "revenue" || fee <= 0) return "";
    return ` = ${money(subtotal)} ${t("productsWord", lang)} + ${money(fee)} ${t("feeWord", lang)}`;
  }

  const metricLabel = t(metric === "revenue" ? "revenueWord" : "unitsSoldWord", lang);
  const title = `${t("period_" + period, lang)} ${metricLabel}`;
  const totalLabel = t(metric === "revenue" ? "totalRevenue" : "totalUnitsSold", lang);

  // Switching period/chart type invalidates whatever point was selected.
  function changePeriod(p: Period) { setPeriod(p); setSelected(null); }
  function pick(i: number) { setSelected((cur) => (cur === i ? null : i)); }

  const colWidth = period === "day" ? 22 : 40;

  return (
    <div className="panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {(["bar", "line"] as ChartType[]).map((c) => (
              <button key={c} type="button" onClick={() => setChartType(c)}
                className={"btn btn-sm " + (chartType === c ? "btn-amber" : "btn-ghost")}>
                {t("chart_" + c, lang)}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {(["day", "month", "quarter", "year"] as Period[]).map((p) => (
              <button key={p} type="button" onClick={() => changePeriod(p)}
                className={"btn btn-sm " + (period === p ? "btn-amber" : "btn-ghost")}>
                {t("period_" + p, lang)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Total for the visible range, or — when a point is clicked — that
          single point's value in the exact same "Total revenue:" wording,
          just without the date prefix (the date is already shown as the
          bolded label under the chart). Includes the products vs
          delivery-fee split when there's a fee to show. */}
      <p className="hint" style={{ margin: "0 0 10px" }}>
        {selected !== null ? (
          <>
            {totalLabel}: <b style={{ color: "var(--ink)" }}>{format(raw[selected].value)}</b>
            {breakdown(raw[selected].subtotal, raw[selected].fee)}
          </>
        ) : (
          <>
            {totalLabel}: <b style={{ color: "var(--ink)" }}>{format(periodTotal)}</b>
            {breakdown(periodSubtotal, periodFee)}
          </>
        )}
      </p>

      <div style={{ overflowX: "auto" }}>
        {!hasAnyData ? (
          <p className="hint" style={{ padding: "24px 0", textAlign: "center" }}>{t("noDataYet", lang)}</p>
        ) : (
        <div style={{ minWidth: raw.length * colWidth }}>
          {chartType === "bar" ? (
            <BarRow points={raw} max={max} colWidth={colWidth} selected={selected} onPick={pick} format={format} breakdown={breakdown} />
          ) : (
            <LineRow points={raw} max={max} colWidth={colWidth} selected={selected} onPick={pick} format={format} breakdown={breakdown} />
          )}
          <div style={{ display: "flex", marginTop: 4 }}>
            {raw.map((p, i) => (
              <span
                key={i}
                className="mono"
                onClick={() => pick(i)}
                style={{
                  flex: `0 0 ${colWidth}px`, textAlign: "center", fontSize: 9, cursor: "pointer",
                  color: selected === i ? "var(--ink)" : "var(--muted)",
                  fontWeight: selected === i ? 700 : 400,
                }}
              >
                {p.label}
              </span>
            ))}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

interface Pt { label: string; value: number; subtotal: number; fee: number }
interface RowProps {
  points: Pt[]; max: number; colWidth: number; selected: number | null;
  onPick: (i: number) => void; format: (v: number) => string;
  breakdown: (subtotal: number, fee: number) => string;
}

function BarRow({ points, max, colWidth, selected, onPick, format, breakdown }: RowProps) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", height: CHART_H }}>
      {points.map((p, i) => {
        const h = Math.round((p.value / max) * 100);
        const isSel = selected === i;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onPick(i)}
            title={`${p.label}: ${format(p.value)}${breakdown(p.subtotal, p.fee)}`}
            aria-label={`${p.label}: ${format(p.value)}${breakdown(p.subtotal, p.fee)}`}
            style={{
              flex: `0 0 ${colWidth}px`, height: `${Math.max(h, p.value > 0 ? 4 : 1)}%`,
              background: isSel ? "var(--ink)" : p.value > 0 ? "var(--amber)" : "var(--line-2)",
              border: 0, padding: "0 2px", cursor: "pointer",
            }}
          >
            <span style={{
              display: "block", width: "100%", height: "100%",
              borderRadius: "3px 3px 0 0", minHeight: 2,
              background: isSel ? "var(--ink)" : p.value > 0 ? "var(--amber)" : "var(--line-2)",
            }} />
          </button>
        );
      })}
    </div>
  );
}

function LineRow({ points, max, colWidth, selected, onPick, format, breakdown }: RowProps) {
  const w = Math.max(1, points.length - 1) * colWidth;
  const xy = points.map((p, i) => {
    const x = points.length > 1 ? (i / (points.length - 1)) * w : w / 2;
    const y = CHART_H - (p.value / max) * (CHART_H - 12) - 4;
    return { x, y, ...p };
  });
  const path = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  return (
    <svg width={w + colWidth} height={CHART_H} style={{ display: "block", overflow: "visible" }}>
      <path d={path} fill="none" stroke="var(--amber)" strokeWidth={2} />
      {xy.map((p, i) => (
        <g key={i} onClick={() => onPick(i)} style={{ cursor: "pointer" }}>
          <circle cx={p.x} cy={p.y} r={selected === i ? 16 : 12} fill="transparent" />
          <circle
            cx={p.x} cy={p.y} r={selected === i ? 5 : 3.5}
            fill={selected === i ? "var(--ink)" : "var(--amber)"}
            stroke="#fff" strokeWidth={1.5}
          >
            <title>{`${p.label}: ${format(p.value)}${breakdown(p.subtotal, p.fee)}`}</title>
          </circle>
        </g>
      ))}
    </svg>
  );
}
