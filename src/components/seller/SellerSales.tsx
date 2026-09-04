"use client";
import { BarSeries, RankedBars } from "@/components/admin/Charts";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { SellerSalesReport } from "@/lib/sellerSales";
import type { Lang } from "@/lib/types";

/* A store's own sales.
 *
 * The charts come from components/admin/Charts.tsx rather than being drawn
 * again here. They are generic -- points in, rectangles out -- and a second
 * copy would drift in the small ways that make two screens in one product
 * look like two products.
 *
 * TWO TOTALS, SHOWN TOGETHER AND LABELLED. "All orders" is what has been
 * sold; "completed only" is what has actually been delivered and is
 * therefore what the earnings figure on the dashboard is built from. A
 * store that saw only the first would think it was owed more than it is,
 * and one that saw only the second would think a good month was a bad one.
 * Showing one and calling it "sales" is how that argument starts. */
export default function SellerSales({
  lang, report, rate,
}: { lang: Lang; report: SellerSalesReport; rate: number }) {
  const { all, completed } = report;

  return (
    <>
      <h1>{t("sellerSales", lang)}</h1>
      <p className="hint" style={{ marginTop: -6 }}>
        {t("commissionRate", lang)}: {rate}%
      </p>

      <div className="panel">
        <h3>{t("sellerAllOrders", lang)}</h3>
        <div className="stat stat-fit">
          <div><b>{all.orders}</b><span>{t("sellerOrders", lang)}</span></div>
          <div><b>{all.units}</b><span>{t("sellerUnitsSold", lang)}</span></div>
          <div><b>{money(all.gross)}</b><span>{t("grossSales", lang)}</span></div>
          <div><b>{money(all.averageOrder)}</b><span>{t("sellerAvgOrder", lang)}</span></div>
        </div>

        <h3 style={{ marginTop: 16 }}>{t("sellerCompletedOnly", lang)}</h3>
        <div className="kv"><span>{t("grossSales", lang)}</span><b>{money(completed.gross)}</b></div>
        <div className="kv">
          <span>{t("marketplaceCommission", lang)}</span><b>-{money(completed.commission)}</b>
        </div>
        <div className="kv total">
          <span>{t("sellerEarnings", lang)}</span><b>{money(completed.net)}</b>
        </div>
      </div>

      <div className="panel">
        <h3>{t("sellerByMonth", lang)}</h3>
        <BarSeries
          points={report.byMonth.map((m) => ({ label: m.period.slice(5), value: m.gross }))}
          emptyLabel={t("sellerSalesNone", lang)}
        />
      </div>

      <div className="panel">
        <h3>{t("sellerTopProducts", lang)}</h3>
        <RankedBars
          rows={report.topProducts.map((p) => ({
            key: p.productId,
            label: p.name,
            value: p.gross,
            // Share of this store's own revenue, not of the marketplace's.
            share: all.gross > 0 ? p.gross / all.gross : 0,
            meta: `${p.units} ${t("sellerUnitsSold", lang).toLowerCase()}`,
          }))}
          emptyLabel={t("sellerSalesNone", lang)}
        />
      </div>
    </>
  );
}
