"use client";
import { useState } from "react";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { DailyPoint, PeriodPoint } from "@/lib/stats";
import type { Lang } from "@/lib/types";

type Period = "day" | "month" | "quarter" | "year";

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

  const raw =
    period === "day" ? daily.map((d) => ({ label: d.date.slice(5), value: d[metric] })) :
    period === "month" ? monthly.map((m) => ({ label: m.label.slice(2), value: m[metric] })) :
    period === "quarter" ? quarterly.map((q) => ({ label: q.label, value: q[metric] })) :
    yearly.map((y) => ({ label: y.label, value: y[metric] }));

  const max = Math.max(1, ...raw.map((p) => p.value));
  const periodTotal = raw.reduce((a, p) => a + p.value, 0);
  const format = (v: number) => (metric === "revenue" ? money(v) : String(v));

  // Title tracks the selected period — "Daily Revenue", "Quarterly Revenue",
  // "Monthly Units Sold", etc. — rather than a fixed label that never changed.
  const metricLabel = t(metric === "revenue" ? "revenueWord" : "unitsSoldWord", lang);
  const title = `${t("period_" + period, lang)} ${metricLabel}`;
  const totalLabel = t(metric === "revenue" ? "totalRevenue" : "totalUnitsSold", lang);

  return (
    <div className="panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div style={{ display: "flex", gap: 4 }}>
          {(["day", "month", "quarter", "year"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={"btn btn-sm " + (period === p ? "btn-amber" : "btn-ghost")}
            >
              {t("period_" + p, lang)}
            </button>
          ))}
        </div>
      </div>

      <p className="hint" style={{ margin: "0 0 10px" }}>
        {totalLabel}: <b style={{ color: "var(--ink)" }}>{format(periodTotal)}</b>
      </p>

      <div style={{ display: "flex", alignItems: "flex-end", gap: period === "day" ? 4 : 8, height: 140, overflowX: "auto" }}>
        {raw.map((p, i) => {
          const h = Math.round((p.value / max) * 100);
          return (
            <div key={i} style={{ flex: "1 0 auto", minWidth: period === "day" ? 14 : 34, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div
                title={`${p.label}: ${format(p.value)}`}
                style={{
                  width: "100%", height: `${Math.max(h, p.value > 0 ? 4 : 1)}%`,
                  background: p.value > 0 ? "var(--amber)" : "var(--line-2)",
                  borderRadius: "3px 3px 0 0", minHeight: 2,
                }}
              />
              <span className="mono" style={{ fontSize: 9, color: "var(--muted)", whiteSpace: "nowrap" }}>{p.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
