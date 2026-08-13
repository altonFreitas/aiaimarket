"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { setOrderStatusAsSeller } from "@/lib/actions/seller-orders";
import { money, nowIso, addrLine, flowFor } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { SellerOrderView } from "@/lib/data/seller";
import type { Lang, OrderStatus } from "@/lib/types";

const STATUS_PILL: Record<string, "ok" | "warn" | "bad"> = {
  new: "warn", confirmed: "warn", preparing: "warn", out: "warn", arrived: "warn",
  completed: "ok", cancelled: "bad",
};

/** Shows only this seller's own items per order — never another
 * seller's, and never a mixed-cart order's full total (see
 * getSellerOrders(), which already reduced each order down before this
 * ever renders). Status can only be changed on an order made up
 * entirely of this seller's own items (see allItemsMine /
 * setOrderStatusAsSeller) — order.status is one column shared by the
 * whole order, so it isn't this seller's alone to set on a mixed-seller
 * order. */
export default function SellerOrdersList({ lang, orders, commissionRatePercent }: {
  lang: Lang; orders: SellerOrderView[]; commissionRatePercent: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function changeStatus(orderId: string, status: OrderStatus) {
    setBusyId(orderId);
    try {
      await setOrderStatusAsSeller(orderId, status);
      toast(t("st_" + status, lang));
      router.refresh();
    } catch (e) {
      toast(String((e as Error).message), true);
    }
    setBusyId(null);
  }

  return (
    <>
      <h1>{t("sellerOrders", lang)}</h1>

      {orders.length ? (
        <div className="list">
          {orders.map((o) => {
            const commission = o.mySubtotal * (commissionRatePercent / 100);
            const earnings = o.mySubtotal - commission;
            const addr = o.mode === "pickup" ? t("pickup", lang) : addrLine(o);
            const flow = flowFor(o.mode);
            const at = flow.indexOf(o.status);
            const busy = busyId === o.id;
            return (
              <div className="panel" key={o.id} style={{ opacity: busy ? 0.6 : 1 }}>
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

                {o.allItemsMine ? (
                  o.status !== "cancelled" && (
                    <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                      <p className="hint" style={{ margin: "0 0 6px" }}>{t("markStatus", lang)}</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {flow.map((s, i) => (
                          <button key={s} type="button"
                            className={"btn btn-sm " + (i === at ? "btn-amber" : "btn-ghost")}
                            disabled={busy || i < at}
                            onClick={() => changeStatus(o.id, s)}>
                            {o.mode === "pickup" && i === flow.length - 1 ? t("st_completed_pickup", lang) : t("st_" + s, lang)}
                          </button>
                        ))}
                        {o.status !== "completed" && (
                          <button type="button" className="btn btn-sm btn-danger" disabled={busy}
                            onClick={() => changeStatus(o.id, "cancelled" as OrderStatus)}>
                            {t("st_cancelled", lang)}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                ) : (
                  <p className="hint" style={{ marginTop: 10 }}>{t("mixedSellerOrderNote", lang)}</p>
                )}
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
