import { money, nowIso, addrLine } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { SellerOrderView } from "@/lib/data/seller";
import type { Lang } from "@/lib/types";

const STATUS_PILL: Record<string, "ok" | "warn" | "bad"> = {
  new: "warn", confirmed: "warn", preparing: "warn", out: "warn", arrived: "warn",
  completed: "ok", cancelled: "bad",
};

/** Shows only this seller's own items per order — never another
 * seller's, and never a mixed-cart order's full total (see
 * getSellerOrders(), which already reduced each order down before this
 * ever renders). */
export default function SellerOrdersList({ lang, orders, commissionRatePercent }: {
  lang: Lang; orders: SellerOrderView[]; commissionRatePercent: number;
}) {
  return (
    <>
      <h1>{t("sellerOrders", lang)}</h1>

      {orders.length ? (
        <div className="list">
          {orders.map((o) => {
            const commission = o.mySubtotal * (commissionRatePercent / 100);
            const earnings = o.mySubtotal - commission;
            const addr = o.mode === "pickup" ? t("pickup", lang) : addrLine(o);
            return (
              <div className="panel" key={o.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div>
                    <b>{o.ref}</b>
                    <div className="sub" style={{ margin: "2px 0 0" }}>
                      {o.buyer_name} · {o.buyer_phone} · {nowIso(o.created_at)}
                    </div>
                    <div className="sub" style={{ margin: "2px 0 0" }}>{addr}</div>
                  </div>
                  <span className={"pill " + (STATUS_PILL[o.status] || "warn")}>
                    {t(o.status === "completed" ? "st_completed" : "st_" + o.status, lang)}
                  </span>
                </div>

                <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                  {o.myItems.map((it, i) => (
                    <div className="kv" key={i}>
                      <span>{it.name}{it.size ? " · " + it.size : ""} × {it.qty}</span>
                      <b>{money(it.price * it.qty)}</b>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 8, fontSize: 13 }}>
                  <div className="kv"><span>{t("grossSales", lang)}</span><b>{money(o.mySubtotal)}</b></div>
                  <div className="kv"><span>{t("marketplaceCommission", lang)} ({commissionRatePercent}%)</span><b>-{money(commission)}</b></div>
                  <div className="kv total"><span>{t("sellerEarnings", lang)}</span><b>{money(earnings)}</b></div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty"><p>{t("noResults", lang)}</p></div>
      )}
    </>
  );
}
