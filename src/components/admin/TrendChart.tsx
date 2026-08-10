"use client";
import { useState } from "react";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { DailyPoint, DrillData, PeriodPoint } from "@/lib/stats";
import type { Lang } from "@/lib/types";

type Period = "day" | "month" | "quarter" | "year";
type ChartType = "bar" | "line";
const CHART_H = 140;

export default function TrendChart({
  lang, metric, daily, monthly, quarterly, yearly, drillData,
}: {
  lang: Lang;
  metric: "revenue" | "qty";
  daily: DailyPoint[];
  monthly: PeriodPoint[];
  quarterly: PeriodPoint[];
  yearly: PeriodPoint[];
  drillData: DrillData;
}) {
  const [period, setPeriod] = useState<Period>("day");
  const [chartType, setChartType] = useState<ChartType>("bar"); // bar is the default, per request
  const [selected, setSelected] = useState<number | null>(null);

  // Only the Year button drills — clicking a specific year shows its four
  // quarters. Day/Month/Quarter stay exactly as flat, independent views;
  // clicking a bar there just reveals its value, same as always.
  const [yearDrill, setYearDrill] = useState<number | null>(null);

  const source: Array<PeriodPoint | DailyPoint> =
    period === "day" ? daily :
    period === "month" ? monthly :
    period === "quarter" ? quarterly :
    yearDrill === null ? yearly : (drillData.quartersByYear[yearDrill] || []);

  const firstActive = source.findIndex((p) => p.orders > 0);
  const trimmed = firstActive === -1 ? source : source.slice(firstActive);
  const hasAnyData = firstActive !== -1;

  const raw = trimmed.map((p) => ({
    label: period === "day" ? (p as DailyPoint).date.slice(5) : (p as PeriodPoint).label,
    value: p[metric], subtotal: p.subtotal, fee: p.fee,
  }));

  const max = Math.max(1, ...raw.map((p) => p.value));
  const periodTotal = raw.reduce((a, p) => a + p.value, 0);
  const periodSubtotal = raw.reduce((a, p) => a + p.subtotal, 0);
  const periodFee = raw.reduce((a, p) => a + p.fee, 0);
  const format = (v: number) => (metric === "revenue" ? money(v) : String(v));

  function breakdown(subtotal: number, fee: number): string {
    if (metric !== "revenue" || fee <= 0) return "";
    return ` = ${money(subtotal)} ${t("productsWord", lang)} + ${money(fee)} ${t("feeWord", lang)}`;
  }
  function breakdownOnly(subtotal: number, fee: number) {
    if (fee > 0) return `${money(subtotal)} ${t("productsWord", lang)} + ${money(fee)} ${t("feeWord", lang)}`;
    return `${money(subtotal)} ${t("productsWord", lang)}`;
  }

  const metricLabel = t(metric === "revenue" ? "revenueWord" : "unitsSoldWord", lang);
  const title =
    period === "year" && yearDrill !== null
      ? `${t("period_quarter", lang)} ${metricLabel} — ${yearDrill}`
      : `${t("period_" + period, lang)} ${metricLabel}`;
  const totalLabel = t(metric === "revenue" ? "totalRevenue" : "totalUnitsSold", lang);
  const isYearDrilled = period === "year" && yearDrill !== null;

  function changePeriod(p: Period) { setPeriod(p); setSelected(null); setYearDrill(null); }

  function pick(i: number) {
    if (period === "year" && yearDrill === null) {
      setYearDrill(Number((trimmed[i] as PeriodPoint).label));
      setSelected(null);
      return;
    }
    setSelected((cur) => (cur === i ? null : i));
  }
  function backToYears() { setYearDrill(null); setSelected(null); }

  const colWidth = period === "day" ? 22 : isYearDrilled ? 60 : 40;

  return (
    <div className="panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isYearDrilled && (
            <button type="button" onClick={backToYears} className="btn btn-sm btn-ghost" aria-label={t("back", lang)}>
              ← {t("back", lang)}
            </button>
          )}
          <h3 style={{ margin: 0 }}>{title}</h3>
        </div>
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

      {period === "year" && yearDrill === null && (
        <p className="hint" style={{ margin: "0 0 6px" }}>{t("drillHint", lang)}</p>
      )}

      <p className="hint" style={{ margin: "0 0 10px" }}>
        {selected !== null ? (
          metric === "revenue" ? (
            breakdownOnly(raw[selected].subtotal, raw[selected].fee)
          ) : (
            <>{totalLabel}: <b style={{ color: "var(--ink)" }}>{format(raw[selected].value)}</b></>
          )
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
            <BarRow points={raw} max={max} colWidth={colWidth} selected={selected} onPick={pick} format={format} />
          ) : (
            <LineRow points={raw} max={max} colWidth={colWidth} selected={selected} onPick={pick} format={format} />
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
}

function BarRow({ points, max, colWidth, selected, onPick, format }: RowProps) {
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
            title={`${p.label}: ${format(p.value)}${breakdownTooltip(p)}`}
            aria-label={`${p.label}: ${format(p.value)}`}
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
function breakdownTooltip(p: Pt) {
  return p.fee > 0 ? ` (${money(p.subtotal)} + ${money(p.fee)} fee)` : "";
}

function LineRow({ points, max, colWidth, selected, onPick, format }: RowProps) {
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
            <title>{`${p.label}: ${format(p.value)}`}</title>
          </circle>
        </g>
      ))}
    </svg>
  );
}
