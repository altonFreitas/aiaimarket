"use client";
import Link from "next/link";
import { useBasket } from "@/lib/useBasket";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export default function BasketView({ lang, storeName }: { lang: Lang; storeName: string }) {
  const { lines, ready, setQty, remove, subtotal } = useBasket();

  // Nothing is known about the basket until the browser's copy has been
  // read. Saying "empty" here would be saying it about a basket nobody has
  // looked in yet -- which is exactly what a shopper saw flash over their
  // order every time they came back to this page. The heading is the same
  // either way, so showing it alone costs no layout jump.
  if (!ready) {
    return (
      <div className="wrap" aria-busy="true">
        <h1>{t("list", lang)}</h1>
      </div>
    );
  }

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

  // Group by seller only when it's actually useful — a single-seller
  // basket (the overwhelmingly common case: everything from the
  // platform's own catalog) just renders as one flat list, same as
  // before. Items keep their real index in `lines` (needed for
  // setQty/remove), just reordered visually by group.
  const withIndex = lines.map((l, i) => ({ l, i }));
  const groupKey = (sellerId: string | null | undefined) => sellerId || "__platform__";
  const sellerIds = Array.from(new Set(withIndex.map(({ l }) => groupKey(l.seller_id))));
  const multiSeller = sellerIds.length > 1;

  const groups = multiSeller
    ? sellerIds.map((key) => ({
        key,
        // seller_id is never actually null (it defaults to the platform
        // owner's own id) -- the platform owner also just never has a
        // row in `sellers`, so `sellerName` naturally comes back empty
        // only for their own products. That's the real signal here.
        sellerName: withIndex.find(({ l }) => groupKey(l.seller_id) === key)?.l.sellerName || null,
        items: withIndex.filter(({ l }) => groupKey(l.seller_id) === key),
      }))
    : [{ key: "__all__", sellerName: null, items: withIndex }];

  return (
    <div className="wrap">
      <h1>{t("list", lang)}</h1>
      {groups.map((g) => (
        <div key={g.key} style={{ marginBottom: 14 }}>
          {multiSeller && (
            <p className="hint" style={{ margin: "0 0 6px", fontWeight: 600 }}>
              {g.sellerName ? `${t("soldBy", lang)} ${g.sellerName}` : storeName}
            </p>
          )}
          <div className="list">
            {g.items.map(({ l, i }) => (
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
        </div>
      ))}
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
