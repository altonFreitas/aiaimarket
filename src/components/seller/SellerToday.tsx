import Link from "next/link";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { AttentionItem } from "@/lib/attention";
import type { Lang } from "@/lib/types";

/* A store's home page: what is waiting, then how it is going.
 *
 * The same two halves, in the same order and the same markup, as the
 * owner's home (components/admin/AdminHome.tsx). That is the point of
 * selling it: a seller who has seen the marketplace's own screen already
 * knows how to read this one.
 *
 * A server component. Nothing on it changes without a page load -- the
 * counts come from the database and the cards are links -- so there is no
 * reason to ship it to the browser.
 */

const SEVERITY_CLASS: Record<AttentionItem["severity"], string> = {
  urgent: "attn-urgent", warn: "attn-warn", info: "attn-info",
};

export interface SellerFigures {
  revenue: number;
  orders: number;
  qty: number;
  avgOrderValue: number;
  /** Against the previous window. Null when there was nothing before to
   * compare against -- which is not the same as no change, and is drawn
   * as an em dash rather than as 0%. */
  revenueChange: number | null;
  ordersChange: number | null;
  qtyChange: number | null;
}

function Delta({ value }: { value: number | null }) {
  if (value == null) return <em className="kpi-delta">—</em>;
  const up = value >= 0;
  return (
    <em className={"kpi-delta " + (up ? "up" : "down")}>
      {up ? "+" : ""}{(value * 100).toFixed(1)}%
    </em>
  );
}

export default function SellerToday({
  lang, storeName, items, figures, days,
}: {
  lang: Lang;
  storeName: string;
  items: AttentionItem[];
  figures: SellerFigures;
  days: number;
}) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("sellerToday", lang)}</h1>
          <p className="sub">{storeName}</p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="panel">
          <div className="empty"><p>{t("sellerTodayClear", lang)}</p></div>
        </div>
      ) : (
        <div className="attn-grid">
          {items.map((i) => (
            <Link key={i.kind} href={i.href} className={"attn-card " + SEVERITY_CLASS[i.severity]}>
              <b className="attn-n">{i.count}</b>
              <span className="attn-label">{fill(t(i.labelKey, lang), i.vars)}</span>
              <span className="attn-hint">{fill(t(i.hintKey, lang), i.vars)}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="panel-head ov-head">
        <div>
          <h2>{t("sellerTodayHowGoing", lang)}</h2>
          <p className="sub">
            {t("sellerTodayBasis", lang).replaceAll("30", String(days))}
          </p>
        </div>
      </div>

      <div className="stat stat-fit">
        <div>
          <b>{money(figures.revenue)}</b>
          <span>{t("revenue", lang)}</span>
          <Delta value={figures.revenueChange} />
        </div>
        <div>
          <b>{figures.orders}</b>
          <span>{t("orders", lang)}</span>
          <Delta value={figures.ordersChange} />
        </div>
        <div>
          <b>{figures.qty}</b>
          <span>{t("qty", lang)}</span>
          <Delta value={figures.qtyChange} />
        </div>
        <div>
          <b>{money(figures.avgOrderValue)}</b>
          <span>{t("avgOrderValue", lang)}</span>
        </div>
      </div>
    </>
  );
}

/** Substitutes {name} placeholders, same as the owner's home. Returns the
 * string untouched when an item has no values, which is most of them. */
function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return Object.entries(vars).reduce(
    (out, [k, v]) => out.replaceAll(`{${k}}`, String(v)), text);
}
