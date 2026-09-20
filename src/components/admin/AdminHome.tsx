"use client";
import Link from "next/link";
import { DualBars, RankedBars, type DualPoint, type RankedRow } from "./Charts";
import { buildKpis, type KpiInput } from "@/lib/adminHomeKpis";
import { t } from "@/lib/i18n";
import type { AttentionItem } from "@/lib/attention";
import type { Lang } from "@/lib/types";

/* THE FRONT PAGE, AS ONE SCREEN OF DASHBOARD.
 *
 * WHAT IT WAS, AND THE NUMBER THAT GAVE IT AWAY. Six figures with nothing
 * saying what any of them measured, and a trend chart below the fold. The
 * row read "money in $138.23" beside "net profit $259.43" -- a shop that
 * had kept almost twice what it took. Both figures were right and the row
 * was wrong: the first covered thirty days and the second covered every
 * day the shop had ever traded, and nothing on the page said so.
 *
 * SO EVERY TILE NOW CARRIES ITS BASIS. "Last 30 days", "right now", "all
 * time" -- see Kpi.basisKey. A figure whose period is unstated is not a
 * documentation gap; it is a wrong number that happens to be spelled
 * correctly.
 *
 * WHAT IS ON IT, and nothing below the fold:
 *
 *   1. Six tiles, each the one figure that matters from an area of the
 *      admin, each a link to the screen that computes it. See
 *      lib/adminHomeKpis.ts for which six and why.
 *   2. Three panels: the two sides of the business by month, what sells,
 *      and what needs doing.
 *
 * WHAT MOVED RATHER THAN DIED. The deep overview -- range tabs, year on
 * year, the written summary -- is a screen of its own at /admin/overview
 * now, and the money-in-against-money-out tile links to it. It was the one
 * thing this page computed that no other screen could, so it was not
 * something to delete for space; it was something that had outgrown being
 * the bottom half of a front page.
 */

const SEVERITY_CLASS: Record<AttentionItem["severity"], string> = {
  urgent: "attn-urgent", warn: "attn-warn", info: "attn-info",
};

/** Which accent each tile wears. Not decoration: six identical white cards
 * make the eye read left to right and start again, where a colour per area
 * lets somebody look straight at the one they came for. */
const ACCENT: Record<string, string> = {
  sales: "kpi-a-sales", grossProfit: "kpi-a-profit", orders: "kpi-a-orders",
  catalog: "kpi-a-catalog", procurement: "kpi-a-spend", finance: "kpi-a-finance",
};

export default function AdminHome({
  lang, items, canSales, canProcurement, kpis, flow, categories, loves,
}: {
  lang: Lang;
  items: AttentionItem[];
  canSales: boolean;
  canProcurement: boolean;
  /** One figure per area, already withheld where the account cannot see
   * the screen it comes from. */
  kpis: KpiInput;
  /** Revenue against purchase cost, by month. */
  flow: DualPoint[];
  /** What sold in the window, biggest first. */
  categories: RankedRow[];
  loves: { total: number; top: { id: string; name: string; loves: number } | null } | null;
}) {
  const urgent = items.filter((i) => i.severity === "urgent");
  const tiles = buildKpis(kpis, {
    units: t("kpiUnits", lang),
    products: t("kpiProducts", lang),
    priced: t("kpiPriced", lang),
  });

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <h1>{t("attnTitle", lang)}</h1>
          <p className="sub">
            {items.length
              ? t("attnSub", lang).replace("{n}", String(items.length))
              : t("attnSubClear", lang)}
          </p>
        </div>
        {loves && loves.total > 0 && (
          <Link className="dash-loves" href="/admin/products">
            <b>{loves.total}</b>
            <span>{t("lovesTotal", lang)}</span>
          </Link>
        )}
      </div>

      {tiles.length > 0 && (
        <div className="kpi-row">
          {tiles.map((k) => (
            <Link key={k.key} href={k.href} className={"kpi " + (ACCENT[k.key] ?? "")}>
              <span className="kpi-label">{t(k.labelKey, lang)}</span>
              <b className="kpi-value">{k.value}</b>
              <span className={"kpi-note kpi-" + k.tone}>
                {k.note ?? "—"}
              </span>
              {/* What this figure measures. The whole reason the row can be
                  trusted -- see the note at the top of this file. */}
              <span className="kpi-basis">{t(k.basisKey, lang)}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="dash-grid">
        {(canSales || canProcurement) && (
          <section className="dash-card dash-flow">
            <div className="dash-card-hd">
              <div>
                <h2>{t("ovMoneyTrend", lang)}</h2>
                <p className="sub">{t("dashFlowSub", lang)}</p>
              </div>
              <Link className="dash-more" href="/admin/overview">
                {t("dashFullOverview", lang)} <span aria-hidden="true">→</span>
              </Link>
            </div>
            <DualBars
              points={flow}
              emptyLabel={t("ovNothingInRange", lang)}
              labelA={t("totalSalesRevenue", lang)}
              labelB={t("totalPurchaseValue", lang)}
              format={(n) => `$${Math.round(n).toLocaleString("en-US")}`}
            />
          </section>
        )}

        {canSales && (
          <section className="dash-card dash-cats">
            <div className="dash-card-hd">
              <div>
                <h2>{t("salesByCategory", lang)}</h2>
                <p className="sub">{t("kpiBasisPeriod", lang)}</p>
              </div>
              <Link className="dash-more" href="/admin/sales">
                {t("salesDashboard", lang)} <span aria-hidden="true">→</span>
              </Link>
            </div>
            <RankedBars rows={categories} emptyLabel={t("ovNothingInRange", lang)} limit={5} />
          </section>
        )}

        {/* WHAT NEEDS DOING keeps its place on the front page. It is the
            only thing here anybody can act on this morning, and a
            dashboard that shows six figures and hides the work is a
            report, not a front page. */}
        <section className="dash-card dash-todo">
          <div className="dash-card-hd">
            <div>
              <h2>{t("attnTodo", lang)}</h2>
              {urgent.length > 0 && (
                <p className="sub">
                  {t("attnUrgentFoot", lang).replace("{n}", String(urgent.length))}
                </p>
              )}
            </div>
          </div>
          {!items.length ? (
            <p className="sub dash-clear">{t("attnNothing", lang)}</p>
          ) : (
            <ul className="attn-list">
              {items.map((i) => (
                <li key={i.kind}>
                  <Link href={i.href} className={"attn-row " + SEVERITY_CLASS[i.severity]}>
                    <b className="attn-n">{i.count}</b>
                    <span className="attn-label">{fill(t(i.labelKey, lang), i.vars)}</span>
                    {/* The number above already says how many. Repeating it
                        in the label forced a plural no single string gets
                        right -- "1 products to approve". */}
                    <span className="attn-hint">{fill(t(i.hintKey, lang), i.vars)}</span>
                    <span className="attn-go" aria-hidden="true">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** Substitutes {name} placeholders. Returns the string untouched when an
 * item has no values, which is almost all of them. */
function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return Object.entries(vars).reduce(
    (out, [k, v]) => out.replaceAll(`${"{"}${k}${"}"}`, String(v)), text);
}
