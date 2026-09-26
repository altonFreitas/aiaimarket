"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useBasket } from "@/lib/useBasket";
import { useToast } from "@/components/Toast";
import { canCancel } from "@/lib/orderActions";
import { returnWindow } from "@/lib/returnWindow";
import { placeholder } from "@/lib/placeholder";
import { addrLine, money, nowIso } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Lang, OrderStatus, Settings } from "@/lib/types";
import type { HistoryItem } from "@/lib/orderActions";

export interface HistoryOrder {
  ref: string; buyer_name: string; buyer_phone: string;
  /** The DB's own check constraint, so returnWindow() can read it
   * without a cast. */
  status: OrderStatus; pay_status: string; total: number; created_at: string; mode: string;
  items: HistoryItem[];
  address_line?: string | null;
  municipality?: string | null; post?: string | null;
  suku?: string | null; aldeia?: string | null; landmark?: string | null;
  cancel_requested_at?: string | null;
  currency?: string | null;
  fx_rate?: number | null;
}

/** Every status an order can be in, for the filter. Kept in the order the
 * order itself moves through, so the dropdown reads like a journey rather
 * than an alphabet. */
const STATUSES: OrderStatus[] =
  ["new", "confirmed", "preparing", "out", "arrived", "completed", "cancelled"];

/** Does this order answer to what was typed? Reference or product name --
 * the two things somebody actually remembers about an old order. */
export function matches(o: HistoryOrder, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (o.ref.toLowerCase().includes(needle)) return true;
  return o.items.some((i) => i.name.toLowerCase().includes(needle));
}

export default function OrderHistory({
  orders, lang, phone, settings, onBack,
}: {
  orders: HistoryOrder[];
  lang: Lang;
  phone: string;
  settings?: Settings;
  onBack: () => void;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [open, setOpen] = useState<string | null>(null);
  const { add } = useBasket();
  const { toast } = useToast();

  const shown = useMemo(
    () => orders.filter((o) => matches(o, q) && (!status || o.status === status)),
    [orders, q, status]
  );

  /* BUY AGAIN, AT TODAY'S PRICE.
   *
   * The order's own lines carry what was PAID, which for an order from
   * March is not what the shop sells at now -- adding at it would put a
   * number in the basket that the checkout then quietly corrects. So only
   * lines whose product is still listed, approved and in stock go back in,
   * at the price and ceiling the catalog holds today (see
   * getOrdersByPhone).
   *
   * And it says what it could not do. Silently dropping two of five items
   * is how somebody checks out with half an order and finds out later. */
  function buyAgain(o: HistoryOrder) {
    let added = 0;
    for (const it of o.items) {
      if (!it.now) continue;
      add({
        id: String(it.product_id), name: it.name, size: it.size,
        price: it.now.price, qty: it.qty,
        seller_id: null, sellerName: null,
        image: it.now.image, slug: it.now.slug, stock: it.now.stock,
      });
      added += 1;
    }
    const gone = o.items.length - added;
    if (!added) { toast(t("ohBuyAgainNone", lang), true); return; }
    toast(
      t("ohBuyAgainSome", lang).replace("{n}", String(added))
        + (gone ? " " + t("ohBuyAgainGone", lang).replace("{n}", String(gone)) : "")
    );
  }

  return (
    <div className="wrap">
      <h1>{t("myOrders", lang)}</h1>
      <p className="sub mono">{phone}</p>

      {/* ---- search and filter ------------------------------------- */}
      <div className="oh-tools">
        <div className="field oh-find">
          <label htmlFor="oh-q">{t("ohSearch", lang)}</label>
          <input id="oh-q" type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="CD2026…" autoComplete="off" />
          <p className="hint">{t("ohSearchHint", lang)}</p>
        </div>
        <div className="field oh-filter">
          <label htmlFor="oh-st">{t("status", lang)}</label>
          <select id="oh-st" value={status} onChange={(e) => setStatus(e.target.value as OrderStatus | "")}>
            <option value="">{t("ohAllStatuses", lang)}</option>
            {/* Only statuses this buyer's own orders are actually in. A
                dropdown offering "Cancelled" to somebody who has never had
                an order cancelled is a filter that can only return
                nothing. */}
            {STATUSES.filter((s) => orders.some((o) => o.status === s)).map((s) => (
              <option key={s} value={s}>{t("st_" + s, lang)}</option>
            ))}
          </select>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty"><p>{t("ohNoMatch", lang)}</p></div>
      ) : (
        <div className="oh-list">
          {shown.map((o) => {
            const isOpen = open === o.ref;
            const first = o.items[0];
            const thumb = first?.now?.image || placeholder(first?.name || o.ref);
            const win = returnWindow(o, settings);
            const showCancel = canCancel(o);
            const reorderable = o.items.some((i) => i.now);

            return (
              <div className={"oh-item" + (isOpen ? " on" : "")} key={o.ref}>
                {/* The whole header is the control, not a chevron off to
                    one side: the row is what somebody aims at. */}
                <button type="button" className="oh-head"
                  aria-expanded={isOpen} aria-controls={`oh-b-${o.ref}`}
                  onClick={() => setOpen(isOpen ? null : o.ref)}>
                  <span className="oh-thumb">
                    <Image src={thumb} alt="" width={96} height={96}
                      unoptimized={thumb.startsWith("data:")} />
                  </span>
                  <span className="oh-g">
                    <b>{o.ref}</b>
                    <span className="hint">
                      {nowIso(o.created_at)} · {money(o.total)}
                      {" · "}{t(o.items.length === 1 ? "ohItems1" : "ohItems", lang)
                        .replace("{n}", String(o.items.length))}
                    </span>
                  </span>
                  <span className="oh-pills">
                    <span className={"pill " + (o.pay_status === "paid" ? "ok"
                      : o.pay_status === "unpaid" ? "" : "warn")}>
                      {t("ps_" + o.pay_status, lang)}
                    </span>
                    <span className={"pill " + (o.status === "completed" ? "ok"
                      : o.status === "cancelled" ? "bad" : "warn")}>
                      {t("st_" + o.status, lang)}
                    </span>
                  </span>
                  <svg className="oh-chev" width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="oh-body" id={`oh-b-${o.ref}`}>
                    <ul className="oh-lines">
                      {o.items.map((it, i) => {
                        const img = it.now?.image || placeholder(it.name);
                        const body = (
                          <>
                            <Image src={img} alt="" width={96} height={96}
                              unoptimized={img.startsWith("data:")} />
                            <span className="oh-line-g">
                              <b>{it.name}</b>
                              <span className="hint">
                                {it.size ? it.size + " · " : ""}
                                {it.qty} × {money(it.price)}
                              </span>
                            </span>
                          </>
                        );
                        // Linked only while the product is still listed.
                        // A link to a delisted product is a 404 wearing a
                        // product name.
                        return (
                          <li className="oh-line" key={`${it.product_id}-${it.size}-${i}`}>
                            {it.now
                              ? <Link className="oh-line-a" href={`/p/${it.now.slug}`}>{body}</Link>
                              : <span className="oh-line-a">{body}</span>}
                          </li>
                        );
                      })}
                    </ul>

                    <div className="oh-addr">
                      <b>{o.mode === "pickup" ? t("ohPickupOrder", lang) : t("ohShipTo", lang)}</b>
                      {o.mode !== "pickup" && addrLine(o) && <span>{addrLine(o)}</span>}
                    </div>

                    {/* WHAT IS ACTUALLY STILL POSSIBLE.
                        Track is always there. The other three appear only
                        when they would work: the shop's own return window
                        (returnWindow, which reads the published deadline),
                        the cancellation rule the server enforces
                        (canCancel), and whether anything in the order is
                        still on sale. A button that answers "too late" is
                        a button that should not have been drawn. */}
                    <div className="oh-acts">
                      <Link className="btn btn-sm"
                        href={`/o/${o.ref}?phone=${encodeURIComponent(phone)}`}>
                        {t("trackOrder", lang)}
                      </Link>
                      {reorderable && (
                        <button className="btn btn-sm btn-ghost" type="button"
                          onClick={() => buyAgain(o)}>{t("ohBuyAgain", lang)}</button>
                      )}
                      {win.open && (
                        <Link className="btn btn-sm btn-ghost"
                          href={`/o/${o.ref}?phone=${encodeURIComponent(phone)}#return`}>
                          {t("ohAskReturn", lang)}
                        </Link>
                      )}
                      {showCancel && (
                        <Link className="btn btn-sm btn-ghost"
                          href={`/o/${o.ref}?phone=${encodeURIComponent(phone)}#cancel`}>
                          {t("ohCancelOrder", lang)}
                        </Link>
                      )}
                      {o.cancel_requested_at && (
                        <span className="pill warn">{t("ohCancelPending", lang)}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="btn-row">
        <button className="btn btn-ghost" type="button" onClick={onBack}>
          {t("backToSingle", lang)}
        </button>
      </div>
    </div>
  );
}
