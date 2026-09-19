import Link from "next/link";
import BusinessOverview from "./BusinessOverview";
import { buildKpis, type KpiInput } from "@/lib/adminHomeKpis";
import { t } from "@/lib/i18n";
import type { PackedSalesLines } from "@/lib/salesWire";
import type { AttentionItem } from "@/lib/attention";
import type { Lang, PurchaseOrder } from "@/lib/types";

/* THE FRONT PAGE, IN ONE SCREEN.
 *
 * WHAT IT WAS. A title, two big to-do cards, a row of link buttons, a
 * "customer loves" panel, then six statistics and two charts. Everything
 * on it came from Sales and Procurement; Catalog and the books were not
 * represented at all, and reaching the second figure meant scrolling past
 * the first. A front page that has to be scrolled is not a front page --
 * it is the top of a report.
 *
 * WHAT IT IS NOW, top to bottom, and nothing below the fold:
 *
 *   1. One figure from each area -- money in, money parked, money out,
 *      money kept (see lib/adminHomeKpis.ts for why those four and why in
 *      that order). Each tile is a link to the screen that explains it.
 *   2. What needs doing, as a list rather than as posters. The to-do items
 *      are the only thing here anybody can act on this morning, so they
 *      keep their place above everything discursive -- but a count and a
 *      sentence do not need a card the size of a paragraph.
 *   3. Where to go next, on one line.
 *
 * THE TREND STAYS, BELOW ALL OF THAT. It is the one thing this page
 * computes that no other screen can -- sales against purchases on a single
 * timeline -- so deleting it to save space would lose a capability rather
 * than a decoration. It is simply no longer the thing you have to scroll
 * past to find out how the shop is doing: the four figures above answer
 * that, and the chart is there for whoever wants the shape of it.
 *
 * NOTHING HERE IS REPEATED FROM ANOTHER SCREEN. Each tile is a single
 * number that its own dashboard breaks down in full, and every panel links
 * out rather than redrawing. Two screens saying the same thing in
 * different words is what the Statistics page was deleted for.
 */

const SEVERITY_CLASS: Record<AttentionItem["severity"], string> = {
  urgent: "attn-urgent", warn: "attn-warn", info: "attn-info",
};

const GO_TO: readonly { href: string; key: string }[] = [
  { href: "/admin/sales", key: "salesDashboard" },
  { href: "/admin/orders", key: "orders" },
  { href: "/admin/products", key: "products" },
  { href: "/admin/stock", key: "stockControl" },
  { href: "/admin/procurement/reorder", key: "reorderPlan" },
  { href: "/admin/procurement", key: "procurement" },
];

export default function AdminHome({
  lang, items, lines, purchases, today, canSales, canProcurement,
  kpis, loves, topCustomer, topSupplier,
}: {
  lang: Lang;
  items: AttentionItem[];
  lines: PackedSalesLines;
  purchases: PurchaseOrder[];
  today: string;
  canSales: boolean;
  canProcurement: boolean;
  /** One figure per area, already withheld where the account cannot see
   * the screen it comes from. */
  kpis: KpiInput;
  /** Hearts tapped on the storefront. Null for an account without the
   * catalog section, and on a database that has not run
   * supabase/loves.sql the total is 0 -- see the render below for why
   * that difference matters. */
  loves: { total: number; top: { id: string; name: string; loves: number } | null } | null;
  topCustomer: { label: string; value: number } | null;
  topSupplier: { label: string; value: number } | null;
}) {
  const urgent = items.filter((i) => i.severity === "urgent");
  const tiles = buildKpis(kpis);

  return (
    <>
      <div className="page-head home-head">
        <div>
          <h1>{t("attnTitle", lang)}</h1>
          <p className="sub">
            {items.length
              ? t("attnSub", lang).replace("{n}", String(items.length))
              : t("attnSubClear", lang)}
          </p>
        </div>
        {/* The one thing worth knowing beside the title: hearts tapped and
            not yet converted. Shown only once there is something to count
            -- a shop on its first day would otherwise get a confident
            "0 loves" meaning "nobody has tapped", "the migration has not
            been run" and "the feature is broken" all at once, with no way
            to read which. */}
        {loves && loves.total > 0 && (
          <Link className="home-loves" href="/admin/products">
            <b>{loves.total}</b>
            <span>{t("lovesTotal", lang)}</span>
            {loves.top && <em title={loves.top.name}>{loves.top.name}</em>}
          </Link>
        )}
      </div>

      {tiles.length > 0 && (
        <div className="kpi-row">
          {tiles.map((k) => (
            <Link key={k.key} href={k.href} className="kpi">
              <span className="kpi-label">{t(k.labelKey, lang)}</span>
              <b className="kpi-value">{k.value}</b>
              <span className={"kpi-note kpi-" + k.tone}>
                {k.note ?? t("kpiNoBasis", lang)}
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* WHAT NEEDS DOING, as rows. The old cards gave a count and one
          sentence the height of a paragraph each, which put the second
          figure on this page below the fold on a laptop. Urgent still
          reads differently from the rest -- a list where everything looks
          equally important ranks nothing. */}
      <div className="panel home-attn">
        <div className="panel-head">
          <h3>{t("attnTodo", lang)}</h3>
          {urgent.length > 0 && (
            <span className="hint">
              {t("attnUrgentFoot", lang).replace("{n}", String(urgent.length))}
            </span>
          )}
        </div>
        {!items.length ? (
          <p className="sub home-clear">{t("attnNothing", lang)}</p>
        ) : (
          <ul className="attn-list">
            {items.map((i) => (
              <li key={i.kind}>
                <Link href={i.href} className={"attn-row " + SEVERITY_CLASS[i.severity]}>
                  <b className="attn-n">{i.count}</b>
                  <span className="attn-label">{fill(t(i.labelKey, lang), i.vars)}</span>
                  {/* The number above already says how many. Repeating it
                      in the label duplicated it and forced a plural no
                      single string can get right -- "1 products to
                      approve". */}
                  <span className="attn-hint">{fill(t(i.hintKey, lang), i.vars)}</span>
                  <span className="attn-go" aria-hidden="true">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="home-goto">
        <span className="hint">{t("attnGoTo", lang)}</span>
        {GO_TO.map((g) => (
          <Link key={g.href} className="btn btn-sm btn-ghost" href={g.href}>
            {t(g.key, lang)}
          </Link>
        ))}
      </div>

      {/* An account holding neither Sales nor Procurement has nothing to
          compare, and gets the to-do list alone -- exactly the screen it
          had before. */}
      {(canSales || canProcurement) && (
        <BusinessOverview
          lang={lang} lines={lines} purchases={purchases} today={today}
          canSales={canSales} canProcurement={canProcurement}
          topCustomer={topCustomer} topSupplier={topSupplier}
        />
      )}
    </>
  );
}

/** Substitutes {name} placeholders. Returns the string untouched when an
 * item has no values, which is almost all of them. */
function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return Object.entries(vars).reduce(
    (out, [k, v]) => out.replaceAll(`{${k}}`, String(v)), text);
}
