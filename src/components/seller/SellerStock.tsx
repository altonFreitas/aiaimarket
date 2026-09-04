"use client";
import Link from "next/link";
import { t } from "@/lib/i18n";
import type { RestockRow } from "@/lib/restock";
import type { Lang } from "@/lib/types";

/* What this store needs to reorder.
 *
 * Two lists, in this order, because they are two different jobs. "Out of
 * stock" is money not being taken right now. "Running low" is a heads-up
 * for ordering -- at the threshold the marketplace sets, which is shown so
 * the number is not mysterious.
 *
 * Every row links to the product's own edit page, because the answer to
 * both lists is the same action: put the quantity in. That quantity goes
 * through the stock ledger (see lib/stockLedger.ts), so restocking from
 * here leaves a history rather than overwriting a balance. */
export default function SellerStock({
  lang, pct, low, out, total,
}: {
  lang: Lang;
  pct: number;
  low: RestockRow[];
  out: { id: string; name: string; qty: number }[];
  total: number;
}) {
  const nothingToDo = !low.length && !out.length;

  return (
    <>
      <h1>{t("sellerStock", lang)}</h1>

      <div className="stat stat-fit">
        <div><b>{total}</b><span>{t("sellerProducts", lang)}</span></div>
        <div><b>{out.length}</b><span>{t("stockOut", lang)}</span></div>
        <div><b>{low.length}</b><span>{t("sellerRunningLow", lang)}</span></div>
      </div>

      {nothingToDo ? (
        <div className="empty"><p>{t("sellerStockAllGood", lang)}</p></div>
      ) : (
        <>
          {out.length > 0 && (
            <div className="panel">
              <h3>{t("stockOut", lang)}</h3>
              <div className="list">
                {out.map((p) => (
                  <div className="item" key={p.id}>
                    <div className="g"><b>{p.name}</b></div>
                    <div className="acts">
                      <span className="pill bad">{t("stockOut", lang)}</span>
                      <Link className="btn btn-sm btn-ghost" href={`/seller/products/${p.id}`}>
                        {t("edit", lang)}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {low.length > 0 && (
            <div className="panel">
              <h3>{t("sellerRunningLow", lang)}</h3>
              <p className="hint" style={{ marginTop: -6 }}>
                {t("restockSoonHint", lang).replace("{pct}", String(pct))}
              </p>
              <div className="list">
                {low.map((r) => (
                  <div className="item" key={r.id}>
                    <div className="g">
                      <b>{r.name}</b>
                      {/* "18 of 60 left" is a fact somebody can act on;
                          "below threshold" is not. */}
                      <span>
                        {r.qty} / {r.level} ·{" "}
                        {t("sellerLeftOfLast", lang).replace("{pct}", String(r.remainingPct))}
                      </span>
                    </div>
                    <div className="acts">
                      <span className="pill warn">{r.remainingPct}%</span>
                      <Link className="btn btn-sm btn-ghost" href={`/seller/products/${r.id}`}>
                        {t("edit", lang)}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
