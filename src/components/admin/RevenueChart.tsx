"use client";
import { useState } from "react";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { DailyPoint, PeriodPoint } from "@/lib/stats";
import type { Lang } from "@/lib/types";

type Period = "day" | "month" | "quarter" | "year";

export default function RevenueChart({
  lang, daily, monthly, quarterly, yearly,
}: {
  lang: Lang;
  daily: DailyPoint[];
  monthly: PeriodPoint[];
  quarterly: PeriodPoint[];
  yearly: PeriodPoint[];
}) {
  const [period, setPeriod] = useState<Period>("day");

  const points =
    period === "day" ? daily.map((d) => ({ label: d.date.slice(5), revenue: d.revenue })) :
    period === "month" ? monthly.map((m) => ({ label: m.label.slice(2), revenue: m.revenue })) :
    period === "quarter" ? quarterly.map((q) => ({ label: q.label, revenue: q.revenue })) :
    yearly.map((y) => ({ label: y.label, revenue: y.revenue }));

  const max = Math.max(1, ...points.map((p) => p.revenue));

  return (
    <div className="panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>{t("revenueTrend", lang)}</h3>
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

      <div style={{ display: "flex", alignItems: "flex-end", gap: period === "day" ? 4 : 8, height: 140, overflowX: "auto" }}>
        {points.map((p, i) => {
          const h = Math.round((p.revenue / max) * 100);
          return (
            <div key={i} style={{ flex: "1 0 auto", minWidth: period === "day" ? 14 : 34, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div
                title={`${p.label}: ${money(p.revenue)}`}
                style={{
                  width: "100%", height: `${Math.max(h, p.revenue > 0 ? 4 : 1)}%`,
                  background: p.revenue > 0 ? "var(--amber)" : "var(--line-2)",
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
