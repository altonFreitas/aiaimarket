"use client";
import { BarSeries, RankedBars } from "../Charts";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { SellerProfile } from "@/lib/sales";
import type { Lang } from "@/lib/types";

/* One store, opened from the seller table above it.
 *
 * WHY THIS EXISTS AND IS NOT JUST THE SELLER FILTER. Filtering the whole
 * dashboard to one store answers "what would this page look like if that
 * store were the whole business" -- useful, and still one button away
 * below. It is the wrong first move for the question actually being asked,
 * which is "who is this store", because it throws away the comparison: the
 * rest of the page stops showing the marketplace this store is part of.
 *
 * So this opens IN PLACE, under the row, and every figure in it is
 * computed from the same already-filtered lines as the row -- same dates,
 * same filters. A panel that quietly ignored the date range would print a
 * bigger number than the row it came from and nothing on screen would
 * explain the difference.
 */

function pct(n: number | null): string {
  return n == null ? "—" : `${(n * 100).toFixed(0)}%`;
}
function moneyOrDash(n: number | null): string {
  return n == null ? "—" : money(n);
}

export default function SellerDetail({
  profile, lang, onClose, onFilter,
}: {
  profile: SellerProfile;
  lang: Lang;
  onClose: () => void;
  /** Applies this store as the page-wide filter, for when the answer to
   * "who is this store" turns into "show me only them". */
  onFilter: () => void;
}) {
  const p = profile;
  return (
    <div className="seller-detail">
      <div className="panel-head">
        <div>
          <h4>{p.label || t("storesOwn", lang)}</h4>
          <p className="hint">{t("sellerDetailHint", lang)}</p>
        </div>
        <div className="seller-detail-acts">
          <button type="button" className="btn btn-sm btn-ghost" onClick={onFilter}>
            {t("filterBySeller", lang)}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            {t("close", lang)}
          </button>
        </div>
      </div>

      <div className="stat stat-fit">
        <div><b>{money(p.totals.revenue)}</b><span>{t("revenue", lang)}</span></div>
        <div><b>{p.totals.orders}</b><span>{t("orders", lang)}</span></div>
        <div><b>{p.totals.qty}</b><span>{t("qty", lang)}</span></div>
        <div><b>{money(p.avgOrderValue)}</b><span>{t("avgOrderValue", lang)}</span></div>
        <div>
          <b>{moneyOrDash(p.totals.grossProfit)}</b>
          <span>{t("grossProfit", lang)}</span>
          {/* Margin over the costed part only, and the share it covers,
              because "38%" over a third of the revenue is a different
              statement from "38%" over all of it. */}
          <em className="hint">
            {pct(p.totals.margin)}
            {p.totals.grossProfit != null && p.totals.costCoverage < 1
              ? ` · ${pct(p.totals.costCoverage)}` : ""}
          </em>
        </div>
        <div><b>{p.customers}</b><span>{t("customers", lang)}</span></div>
        <div><b>{p.products}</b><span>{t("products", lang)}</span></div>
        <div>
          <b className="seller-detail-date">{p.lastSale}</b>
          <span>{t("lastSale", lang)}</span>
          <em className="hint">{t("firstSale", lang)}: {p.firstSale}</em>
        </div>
      </div>

      <div className="two-col">
        <div>
          <p className="crumb">{t("topProducts", lang)}</p>
          <RankedBars
            rows={p.topProducts.map((r) => ({
              ...r, value: r.revenue,
              meta: `${r.qty} · ${moneyOrDash(r.grossProfit)}`,
            }))}
            emptyLabel={t("noDataYet", lang)} limit={5}
          />
        </div>
        <div>
          <p className="crumb">{t("topCustomers", lang)}</p>
          <RankedBars
            rows={p.topCustomers.map((r) => ({
              ...r, value: r.revenue,
              // The phone, same as the page-wide panel: this store's best
              // customer is a number the owner can ring.
              meta: `${r.orders} ${t("orders", lang).toLowerCase()}`
                + (r.key && r.key !== "unknown" ? ` · ${r.key}` : ""),
            }))}
            emptyLabel={t("noDataYet", lang)} limit={5}
          />
        </div>
      </div>

      <p className="crumb">{t("revenue", lang)}</p>
      <BarSeries
        points={p.months.map((m) => ({ label: m.label, value: m.revenue }))}
        emptyLabel={t("noDataYet", lang)}
      />

      {p.statuses.length > 0 && (
        <>
          <p className="crumb">{t("orderStatus", lang)}</p>
          <div className="status-tiles">
            {p.statuses.map((s) => (
              <div key={s.status} className="status-tile">
                <b>{s.count}</b>
                <span>{t("st_" + s.status, lang)}</span>
                <em>{money(s.value)}</em>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
