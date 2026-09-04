"use client";
import { useId, useState } from "react";
import { money } from "@/lib/utils";

/* Hand-rolled SVG, no charting library, matching the project's
 * data-frugality rule. A charting bundle would be larger than every other
 * script on the page combined, to draw rectangles. */

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

  /* A row with a meta line under it is nearly twice the height of one
     without, so the five-row window cannot be a single number in the
     stylesheet. The component knows which shape it is rendering; the two
     measured heights live in globals.css beside every other row cap. */
  const hasMeta = shown.some((r) => r.meta);

  return (
    <div className={"ranked" + (hasMeta ? " has-meta" : "")}>
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

/* ---------------------------------------------------------------------------
 * Two series over time.
 *
 * ONE Y AXIS, ALWAYS. Both series on this chart are the same measure in the
 * same unit -- dollars against dollars, or units against units. A second
 * scale would let any two lines be drawn to cross wherever the axes were
 * chosen, which is the most effective way to make a chart lie without a
 * single wrong number in it. Revenue and quantity therefore get two charts
 * rather than one chart with two axes.
 *
 * Hand-rolled SVG, no charting library, for the same data-frugality reason
 * as the bars above.
 * ------------------------------------------------------------------------ */

export interface LinePoint {
  label: string;
  /** Shown under the pointer; the axis label is deliberately shorter. */
  full?: string;
  a: number;
  /** Null when this series has no value at this resolution -- see
   * purchasesResolvable() in lib/overview.ts. A null series is not drawn
   * at all rather than drawn at zero, which would read as "we bought
   * nothing" instead of "this cannot be known by the hour". */
  b: number | null;
}

const LINE_H = 190;
const PAD_L = 4;
const PAD_R = 4;
const PAD_T = 10;
const PAD_B = 22;

/** "Nice" round top for the axis, so the gridline labels are readable
 * numbers rather than 1837.4. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

export function DualLine({
  points, labelA, labelB, emptyLabel, format = money, note,
}: {
  points: LinePoint[];
  labelA: string;
  labelB: string;
  emptyLabel: string;
  format?: (n: number) => string;
  /** Shown beside the legend, for the resolution caveat. */
  note?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId();

  const hasB = points.some((p) => p.b != null);
  const peak = Math.max(...points.map((p) => Math.max(p.a, p.b ?? 0)), 0);
  /* A QUIET PERIOD IS NOT AN ABSENT ONE.
   *
   * This used to bail to a sentence whenever nothing had happened, which
   * on the intraday range meant the whole chart vanished on any day the
   * shop had not sold anything yet -- and "the chart disappeared" reads as
   * a broken screen, not as a quiet morning. A day with no sales still has
   * twenty-four hours in it and still has a money axis; what it does not
   * have is a curve. So the axes are drawn either way and the flat line
   * says what happened, with the label as a note rather than a
   * replacement. Only a period with no BUCKETS at all -- which cannot
   * happen from a range -- has nothing to draw. */
  const flat = peak <= 0;
  const max = flat ? 1 : niceMax(peak);
  if (!points.length) return <Empty label={emptyLabel} />;

  // Viewbox units, scaled to the container by width:100%. A single point
  // would divide by zero, so it is pinned to the middle.
  const W = 600;
  const innerW = W - PAD_L - PAD_R;
  const innerH = LINE_H - PAD_T - PAD_B;
  const x = (i: number) =>
    points.length === 1 ? PAD_L + innerW / 2 : PAD_L + (i / (points.length - 1)) * innerW;
  const y = (v: number) => PAD_T + innerH - (v / max) * innerH;

  const path = (pick: (p: LinePoint) => number) =>
    points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(" ");
  /* The line, closed down to the baseline. Filled at low opacity so the
     two areas can overlap and both still be read -- a solid fill would
     hide whichever series happened to be drawn second. */
  const area = (pick: (p: LinePoint) => number) =>
    `${path(pick)} L${x(points.length - 1).toFixed(1)},${(PAD_T + innerH).toFixed(1)}`
    + ` L${x(0).toFixed(1)},${(PAD_T + innerH).toFixed(1)} Z`;

  // At most six labels along the axis, so a thirty-month series does not
  // print thirty overlapping dates.
  const every = Math.max(1, Math.ceil(points.length / 6));
  const active = hover != null ? points[hover] : null;

  return (
    <div className="linechart">
      {/* A legend for two series is not optional: identity must never be
          carried by colour alone. */}
      <div className="lc-legend">
        <span className="lc-key">
          <span className="lc-swatch" style={{ background: "var(--series-sales)" }} />
          {labelA}
        </span>
        {hasB && (
          <span className="lc-key">
            <span className="lc-swatch" style={{ background: "var(--series-purchases)" }} />
            {labelB}
          </span>
        )}
        {note && <span className="lc-note">{note}</span>}
      </div>

      <svg viewBox={`0 0 ${W} ${LINE_H}`} role="img"
        aria-label={`${labelA} and ${labelB}`}
        onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} className="lc-grid"
            x1={PAD_L} x2={W - PAD_R} y1={y(max * f)} y2={y(max * f)} />
        ))}
        {/* No axis figure on a flat period: the scale is nominal, and
            printing "$1.00" at the top of an empty day invents a number. */}
        {!flat && <text className="lc-tick" x={PAD_L} y={y(max) - 3}>{format(max)}</text>}

        <defs>
          <linearGradient id={`${uid}-a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-sales)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--series-sales)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-b`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-purchases)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--series-purchases)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={area((p) => p.a)} fill={`url(#${uid}-a)`} stroke="none" />
        {hasB && <path d={area((p) => p.b ?? 0)} fill={`url(#${uid}-b)`} stroke="none" />}
        <path className="lc-line" d={path((p) => p.a)} stroke="var(--series-sales)" />
        {hasB && (
          <path className="lc-line" d={path((p) => p.b ?? 0)} stroke="var(--series-purchases)" />
        )}

        {/* The first and last labels are anchored to their own edge, not
            centred. Centred, half of each hangs outside the viewBox -- and
            because the svg is overflow:visible so the tooltip can escape,
            it does not clip, it just sits over whatever is beside the
            chart. The first month was cut in half by the panel edge. */}
        {points.map((p, i) => (
          <text key={p.label} className="lc-tick" x={x(i)} y={LINE_H - 6}
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            opacity={i % every === 0 || i === points.length - 1 ? 1 : 0}>
            {p.label}
          </text>
        ))}

        {active && (
          <line className="lc-crosshair"
            x1={x(hover!)} x2={x(hover!)} y1={PAD_T} y2={PAD_T + innerH} />
        )}
        {active && (
          <>
            <circle className="lc-dot" cx={x(hover!)} cy={y(active.a)} r={4.5}
              fill="var(--series-sales)" />
            {active.b != null && (
              <circle className="lc-dot" cx={x(hover!)} cy={y(active.b)} r={4.5}
                fill="var(--series-purchases)" />
            )}
          </>
        )}

        {flat && (
          <text className="lc-tick lc-flat" x={W / 2} y={PAD_T + innerH / 2} textAnchor="middle">
            {emptyLabel}
          </text>
        )}

        {/* Hit bands, drawn last so they sit above every mark. Each is the
            full height of the plot: aiming at a 9px dot is work the reader
            should not have to do. */}
        {points.map((p, i) => (
          <rect key={"hit" + p.label} className="lc-hit"
            x={x(i) - innerW / Math.max(1, points.length) / 2}
            width={innerW / Math.max(1, points.length)}
            y={PAD_T} height={innerH}
            onMouseEnter={() => setHover(i)} />
        ))}
      </svg>

      {active && (
        <div className="lc-tip" style={{
          left: `${(x(hover!) / W) * 100}%`,
          top: 4,
          transform: x(hover!) > W / 2 ? "translateX(-108%)" : "translateX(8%)",
        }}>
          <b>{active.full ?? active.label}</b>
          <div className="lc-tip-row">
            <span>
              <span className="lc-swatch" style={{ background: "var(--series-sales)" }} />
              {labelA}
            </span>
            <em>{format(active.a)}</em>
          </div>
          {active.b != null && (
            <div className="lc-tip-row">
              <span>
                <span className="lc-swatch" style={{ background: "var(--series-purchases)" }} />
                {labelB}
              </span>
              <em>{format(active.b)}</em>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
