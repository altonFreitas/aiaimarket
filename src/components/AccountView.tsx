"use client";
import { useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import { getOrdersByPhone } from "@/lib/actions/orders";
import { money, nowIso } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

interface OrderSummary {
  ref: string;
  buyer_name: string;
  buyer_phone: string;
  status: string;
  pay_status: string;
  total: number;
  created_at: string;
  mode: string;
}

export default function AccountView({ lang }: { lang: Lang }) {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function find(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const list = await getOrdersByPhone(phone);
      setOrders(list as OrderSummary[]);
      if (!list.length) toast(t("notFound", lang), true);
    } catch {
      toast(t("notFound", lang), true);
    }
    setBusy(false);
  }

  if (orders === null) {
    return (
      <div className="wrap">
        <h1>{t("myOrders", lang)}</h1>
        <p className="sub">{t("myOrdersHint", lang)}</p>
        <form className="panel" onSubmit={find}>
          <div className="field">
            <label htmlFor="acctPhone">{t("phone", lang)}</label>
            <input
              id="acctPhone" type="tel" value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+670 7712 3456" autoComplete="tel"
            />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "…" : t("find", lang)}
          </button>
        </form>
        <div className="note info">{t("myOrdersNote", lang)}</div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <h1>{t("myOrders", lang)}</h1>
      <p className="sub mono">{phone}</p>

      {orders.length ? (
        <div className="list">
          {orders.map((o) => (
            <Link
              key={o.ref}
              className="item"
              href={`/o/${o.ref}?phone=${encodeURIComponent(phone)}`}
              style={{ textDecoration: "none" }}
            >
              <div className="g">
                <b>{o.ref}</b>
                <span>{nowIso(o.created_at)} · {money(o.total)} · {o.mode === "pickup" ? t("pickup", lang) : t("delivery", lang)}</span>
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
        <div className="empty">
          <p>{t("noResults", lang)}</p>
        </div>
      )}

      <div className="btn-row">
        <button className="btn btn-ghost" type="button" onClick={() => setOrders(null)}>
          {t("cancel", lang)}
        </button>
      </div>
    </div>
  );
}
