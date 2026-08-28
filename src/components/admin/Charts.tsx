"use client";
import { money } from "@/lib/utils";

/* Hand-rolled SVG, no charting library -- matching the existing TrendChart
 * and the project's data-frugality rule. A charting bundle would be larger
 * than every other script on the page combined, to draw rectangles. */

const CHART_H = 150;

/** Nothing to plot is a state worth drawing, not a blank space that reads as
 * a broken component. */
function Empty({ label }: { label: string }) {
  return <p className="hint" style={{ margin: "18px 0", textAlign: "center" }}>{label}</p>;
}

export interface SeriesPoint { label: string; value: number; sub?: string }

/** Vertical bars over time. Values are money unless `format` says otherwise. */
export function BarSeries({
  points, emptyLabel, format = money,
}: { points: SeriesPoint[]; emptyLabel: string; format?: (n: number) => string }) {
  const max = Math.max(...points.map((p) => p.value), 0);
  if (!points.length || max <= 0) return <Empty label={emptyLabel} />;

  return (
    <div className="chart">
      <div className="chart-bars" style={{ height: CHART_H }}>
        {points.map((p, i) => {
          const h = Math.max(2, (p.value / max) * CHART_H);
          return (
            <div className="chart-bar-col" key={p.label + i} title={`${p.label}: ${format(p.value)}`}>
              {/* The value rides above its own bar rather than sitting in a
                  legend: on a dense monthly series, matching a legend entry
                  back to a bar is work the reader should not have to do. */}
              <span className="chart-bar-val">{p.value > 0 ? format(p.value) : ""}</span>
              <div className="chart-bar" style={{ height: h }} />
              <span className="chart-bar-lbl">{p.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface RankedRow {
  key: string;
  label: string;
  value: number;
  share: number;
  meta?: string;
}

/** Horizontal ranked bars. Used wherever the question is "who or what is
 * biggest", which a vertical axis of categorical labels answers better than
 * a pie -- long supplier and country names stay readable, and comparing bar
 * lengths beats comparing wedge angles. */
export function RankedBars({
  rows, emptyLabel, limit = 8, format = money, onSelect,
}: {
  rows: RankedRow[];
  emptyLabel: string;
  limit?: number;
  format?: (n: number) => string;
  onSelect?: (key: string) => void;
}) {
  const shown = rows.slice(0, limit);
  const max = Math.max(...shown.map((r) => r.value), 0);
  if (!shown.length || max <= 0) return <Empty label={emptyLabel} />;

  return (
    <div className="ranked">
      {shown.map((r) => {
        const Row = onSelect ? "button" : "div";
        return (
          <Row
            key={r.key}
            className={"ranked-row" + (onSelect ? " is-clickable" : "")}
            {...(onSelect ? { type: "button" as const, onClick: () => onSelect(r.key) } : {})}
          >
            <span className="ranked-label">{r.label}</span>
            <span className="ranked-track">
              <span className="ranked-fill" style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
            <span className="ranked-value">
              {format(r.value)}
              <span className="ranked-share">{(r.share * 100).toFixed(1)}%</span>
            </span>
            {r.meta && <span className="ranked-meta">{r.meta}</span>}
          </Row>
        );
      })}
    </div>
  );
}

/** A single proportion, drawn as a bar rather than a number alone -- used for
 * on-time rates, where "82%" means much more next to a target line. */
export function RateBar({ rate, target = 0.8 }: { rate: number | null; target?: number }) {
  if (rate == null) return <span className="hint">—</span>;
  const pct = Math.round(rate * 100);
  const ok = rate >= target;
  return (
    <span className="rate">
      <span className="rate-track">
        <span className={"rate-fill" + (ok ? " is-ok" : " is-bad")} style={{ width: `${pct}%` }} />
      </span>
      <b className={ok ? "" : "rate-bad-text"}>{pct}%</b>
    </span>
  );
}
