"use client";
import Link from "next/link";
import { useBasket } from "@/lib/useBasket";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export default function BasketView({ lang }: { lang: Lang }) {
  const { lines, setQty, remove, subtotal } = useBasket();

  if (!lines.length) {
    return (
      <div className="wrap">
        <h1>{t("list", lang)}</h1>
        <div className="empty">
          <p>{t("emptyList", lang)}</p>
          <Link className="btn" href="/">{t("browse", lang)}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <h1>{t("list", lang)}</h1>
      <div className="list">
        {lines.map((l, i) => (
          <div className="item" key={`${l.id}-${l.size}-${i}`}>
            <div className="g">
              <b>{l.name}</b>
              <span>{l.size ? l.size + " · " : ""}{money(l.price)}</span>
            </div>
            <div className="qty" style={{ height: 34 }}>
              <button type="button" onClick={() => setQty(i, l.qty - 1)}>−</button>
              <span>{l.qty}</span>
              <button type="button" onClick={() => setQty(i, l.qty + 1)}>+</button>
            </div>
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => remove(i)}>✕</button>
          </div>
        ))}
      </div>
      <div className="panel" style={{ marginTop: 12 }}>
        <div className="kv total">
          <span>{t("subtotal", lang)}</span>
          <b>{money(subtotal)}</b>
        </div>
      </div>
      <div className="btn-row">
        <Link className="btn" href="/checkout">{t("checkout", lang)}</Link>
        <Link className="btn btn-ghost" href="/">{t("browse", lang)}</Link>
      </div>
    </div>
  );
}
