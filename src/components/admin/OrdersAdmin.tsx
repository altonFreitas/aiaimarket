"use client";
import { useState } from "react";
import Link from "next/link";
import { money, nowIso, FLOW } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Lang, Order } from "@/lib/types";

export default function OrdersAdmin({ lang, orders }: { lang: Lang; orders: Order[] }) {
  const [status, setStatus] = useState("");
  const list = status ? orders.filter((o) => o.status === status) : orders;
  const today = orders.filter((o) => Date.now() - new Date(o.created_at).getTime() < 864e5).length;

  return (
    <>
      <h1>{t("orders", lang)}</h1>
      <div className="stat">
        <div><b>{orders.length}</b><span>{t("orders", lang)}</span></div>
        <div><b>{today}</b><span>{t("ordersToday", lang)}</span></div>
        <div><b>{orders.filter((o) => o.status === "new").length}</b><span>{t("st_new", lang)}</span></div>
        <div><b>{orders.filter((o) => o.pay_status === "unpaid").length}</b><span>{t("ps_unpaid", lang)}</span></div>
      </div>

      <div className="bar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("all", lang)}</option>
          {[...FLOW, "cancelled"].map((s) => (
            <option key={s} value={s}>{t("st_" + s, lang)}</option>
          ))}
        </select>
        <span className="count">{list.length}</span>
      </div>

      {list.length ? (
        <div className="list">
          {list.map((o) => (
            <Link className="item" key={o.id} href={`/admin/o/${o.id}`} style={{ textDecoration: "none" }}>
              <div className="g">
                <b>{o.ref} · {o.buyer_name}</b>
                <span>
                  {nowIso(o.created_at)} · {money(o.total)} · {o.buyer_phone}
                  {o.cancel_requested_at ? " · ⚠ " + t("askCancel", lang) : ""}
                </span>
              </div>
              <div className="acts">
                <span className={"pill " + (o.pay_status === "paid" ? "ok" : o.pay_status === "unpaid" ? "" : "warn")}>
                  {t("ps_" + o.pay_status, lang)}
                </span>
                <span className={"pill " + (o.status === "completed" ? "ok" : o.status === "cancelled" ? "bad" : "warn")}>
                  {t("st_" + o.status, lang)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty"><p>{t("noResults", lang)}</p></div>
      )}
    </>
  );
}
