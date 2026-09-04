import Link from "next/link";
import BusinessOverview from "./BusinessOverview";
import { t } from "@/lib/i18n";
import type { PackedSalesLines } from "@/lib/salesWire";
import type { AttentionItem } from "@/lib/attention";
import type { Lang, PurchaseOrder } from "@/lib/types";

/* Two things, in this order: what needs doing today, then how the business
 * is doing.
 *
 * THE TO-DO LIST STAYS FIRST, AND STAYS A TO-DO LIST. It is the only thing
 * on this page that is actionable this morning, and a trend chart above it
 * would push the work below the fold to make room for a number nobody can
 * act on. Every card is still a count of things waiting and a way to get to
 * them, and it still repeats nothing: takings and margin are not on it.
 *
 * THE OVERVIEW BELOW IT IS NOT A SECOND DASHBOARD EITHER. It computes one
 * thing the other screens cannot -- sales measured against purchases on one
 * timeline -- and links out for every breakdown rather than redrawing it.
 * Two screens saying the same thing in different words is the problem the
 * Statistics page was deleted for, and the rule has not changed. */

const SEVERITY_CLASS: Record<AttentionItem["severity"], string> = {
  urgent: "attn-urgent", warn: "attn-warn", info: "attn-info",
};

export default function AdminHome({
  lang, items, lines, purchases, today, canSales, canProcurement,
  topCustomer, topSupplier,
}: {
  lang: Lang;
  items: AttentionItem[];
  lines: PackedSalesLines;
  purchases: PurchaseOrder[];
  today: string;
  canSales: boolean;
  canProcurement: boolean;
  topCustomer: { label: string; value: number } | null;
  topSupplier: { label: string; value: number } | null;
}) {
  const urgent = items.filter((i) => i.severity === "urgent");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("attnTitle", lang)}</h1>
          <p className="sub">
            {items.length
              ? t("attnSub", lang).replace("{n}", String(items.length))
              : t("attnSubClear", lang)}
          </p>
        </div>
      </div>

      {!items.length ? (
        <div className="panel">
          <div className="empty">
            <p>{t("attnNothing", lang)}</p>
            <Link className="btn btn-ghost" href="/admin/sales">{t("salesDashboard", lang)}</Link>
          </div>
        </div>
      ) : (
        <>
          {/* Urgent first and visually separate. A list where everything
              looks equally important ranks nothing. */}
          <div className="attn-grid">
            {items.map((i) => (
              <Link key={i.kind} href={i.href} className={"attn-card " + SEVERITY_CLASS[i.severity]}>
                <b className="attn-n">{i.count}</b>
                {/* The number above already says how many. Repeating it in
                    the label duplicated it and forced a plural no single
                    string can get right -- "1 products to approve". */}
                <span className="attn-label">{fill(t(i.labelKey, lang), i.vars)}</span>
                <span className="attn-hint">{fill(t(i.hintKey, lang), i.vars)}</span>
              </Link>
            ))}
          </div>

          {urgent.length > 0 && (
            <p className="hint attn-foot">
              {t("attnUrgentFoot", lang).replace("{n}", String(urgent.length))}
            </p>
          )}
        </>
      )}

      <div className="panel">
        <div className="panel-head"><h3>{t("attnGoTo", lang)}</h3></div>
        <div className="attn-links">
          <Link className="btn btn-ghost" href="/admin/sales">{t("salesDashboard", lang)}</Link>
          <Link className="btn btn-ghost" href="/admin/orders">{t("orders", lang)}</Link>
          <Link className="btn btn-ghost" href="/admin/products">{t("products", lang)}</Link>
          <Link className="btn btn-ghost" href="/admin/stock">{t("stockControl", lang)}</Link>
          <Link className="btn btn-ghost" href="/admin/procurement/reorder">{t("reorderPlan", lang)}</Link>
          <Link className="btn btn-ghost" href="/admin/procurement">{t("procurement", lang)}</Link>
        </div>
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
