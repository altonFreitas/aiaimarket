import Link from "next/link";
import { t } from "@/lib/i18n";
import type { AttentionItem } from "@/lib/attention";
import type { Lang } from "@/lib/types";

/* A to-do list, not a dashboard. Every card is a count of things waiting
 * and a way to get to them. Takings, margin and trends are on the sales
 * dashboard and are deliberately not repeated here -- two screens saying
 * the same thing in different words is the problem Statistics had. */

const SEVERITY_CLASS: Record<AttentionItem["severity"], string> = {
  urgent: "attn-urgent", warn: "attn-warn", info: "attn-info",
};

export default function AdminHome({ lang, items }: { lang: Lang; items: AttentionItem[] }) {
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
                <span className="attn-label">{t(i.labelKey, lang)}</span>
                <span className="attn-hint">{t(i.hintKey, lang)}</span>
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
    </>
  );
}
