import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import TrendChart from "./TrendChart";
import ExportExcelButton from "./ExportExcelButton";
import type { AdminStats } from "@/lib/stats";
import type { Lang } from "@/lib/types";

const STATUS_LABEL_KEY: Record<string, string> = {
  new: "st_new", confirmed: "st_confirmed", preparing: "st_preparing",
  out: "st_out", arrived: "st_arrived", completed: "st_completed", cancelled: "st_cancelled",
};
const PAY_METHOD_KEY: Record<string, string> = {
  cod: "pm_cod", cop: "pm_cop", bank: "pm_bank", wallet: "pm_wallet", fiar: "pm_fiar",
};
const PAY_STATUS_KEY: Record<string, string> = {
  unpaid: "ps_unpaid", deposit: "ps_deposit", paid: "ps_paid", refunded: "ps_refunded",
};
const ZONE_KEY: Record<string, string> = {
  dili_center: "zone_dili_center", dili_outskirts: "zone_dili_outskirts",
  other_municipality: "zone_other_municipality", pickup: "pickup",
};

export default function StatisticsAdmin({ lang, stats }: { lang: Lang; stats: AdminStats }) {
  const noData = stats.totalOrders === 0;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ margin: 0 }}>{t("statistics", lang)}</h1>
        <ExportExcelButton lang={lang} />
      </div>

      {noData && <div className="note info" style={{ marginBottom: 12 }}>{t("noDataYet", lang)}</div>}

      {/* headline KPIs */}
      <div className="stat">
        <div><b>{money(stats.totalRevenue)}</b><span>{t("totalRevenue", lang)}</span></div>
        <div><b>{stats.completedOrders}</b><span>{t("st_completed", lang)}</span></div>
        <div><b>{money(stats.avgOrderValue)}</b><span>{t("avgOrderValue", lang)}</span></div>
        <div><b>{Math.round(stats.cancellationRate * 100)}%</b><span>{t("cancellationRate", lang)}</span></div>
      </div>
      <div className="stat">
        <div><b>{money(stats.pendingRevenue)}</b><span>{t("pendingRevenue", lang)}</span></div>
        <div><b>{stats.totalOrders}</b><span>{t("orders", lang)}</span></div>
        <div><b>{stats.ordersLast7Days}</b><span>{t("last7Days", lang)}</span></div>
        <div><b>{money(stats.revenueLast7Days)}</b><span>{t("last7Days", lang)}</span></div>
      </div>

      {/* revenue trend, switchable Day / Month / Quarter / Year */}
      <TrendChart
        lang={lang}
        metric="revenue"
        daily={stats.dailyLast14}
        monthly={stats.monthlyLast12}
        quarterly={stats.quarterlyLast8}
        yearly={stats.yearly}
      />

      {/* units-sold trend, same period toggle, same data shape */}
      <TrendChart
        lang={lang}
        metric="qty"
        daily={stats.dailyLast14}
        monthly={stats.monthlyLast12}
        quarterly={stats.quarterlyLast8}
        yearly={stats.yearly}
      />

      <div className="two" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        {/* orders by status */}
        <div className="panel">
          <h3>{t("ordersByStatus", lang)}</h3>
          <BreakdownBars
            rows={stats.byStatus.map((s) => ({ label: t(STATUS_LABEL_KEY[s.status], lang), count: s.count }))}
            total={stats.totalOrders}
          />
        </div>

        {/* payment method + status side by side on desktop */}
        <div className="panel">
          <h3>{t("paymentMethodBreakdown", lang)}</h3>
          <BreakdownBars
            rows={stats.byPayMethod.map((p) => ({ label: t(PAY_METHOD_KEY[p.method], lang), count: p.count }))}
            total={stats.totalOrders}
          />
        </div>

        <div className="panel">
          <h3>{t("paymentStatusBreakdown", lang)}</h3>
          <BreakdownBars
            rows={stats.byPayStatus.map((p) => ({ label: t(PAY_STATUS_KEY[p.status], lang), count: p.count }))}
            total={stats.totalOrders}
          />
        </div>

        <div className="panel">
          <h3>{t("deliveryZoneBreakdown", lang)}</h3>
          <BreakdownBars
            rows={stats.byZone.map((z) => ({ label: t(ZONE_KEY[z.zone], lang), count: z.count }))}
            total={stats.totalOrders}
          />
        </div>
      </div>

      {/* top products */}
      <div className="panel">
        <h3>{t("topProducts", lang)}</h3>
        {stats.topProducts.length ? (
          <div className="rows">
            {stats.topProducts.map((p, i) => (
              <div className="kv" key={i}>
                <span>{p.name}</span>
                <b>{p.qty} {t("units", lang)} · {money(p.revenue)}</b>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">{t("noDataYet", lang)}</p>
        )}
      </div>

      {/* catalog health */}
      <div className="panel">
        <h3>{t("catalogHealth", lang)}</h3>
        <div className="stat">
          <div><b>{stats.liveProducts}</b><span>{t("liveProducts", lang)}</span></div>
          <div><b>{stats.outOfStock}</b><span>{t("outOfStock", lang)}</span></div>
          <div><b>{stats.totalWaClicks}</b><span>{t("waClicks", lang)}</span></div>
          <div><b>{Math.round(stats.clickThroughRate * 100)}%</b><span>{t("clickThroughRate", lang)}</span></div>
        </div>
      </div>
    </>
  );
}

function BreakdownBars({ rows, total }: { rows: Array<{ label: string; count: number }>; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="rows">
      {rows.map((r) => (
        <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
          <span style={{ width: 108, fontSize: 13, flex: "0 0 auto" }}>{r.label}</span>
          <div style={{ flex: 1, background: "var(--line-2)", borderRadius: 4, height: 16, overflow: "hidden" }}>
            <div style={{
              width: `${(r.count / max) * 100}%`, background: "var(--ink)", height: "100%",
              borderRadius: 4, minWidth: r.count ? 3 : 0,
            }} />
          </div>
          <b className="mono" style={{ width: 34, textAlign: "right", fontSize: 13, flex: "0 0 auto" }}>{r.count}</b>
        </div>
      ))}
      {total === 0 && <p className="hint" style={{ margin: "6px 0 0" }}>—</p>}
    </div>
  );
}

