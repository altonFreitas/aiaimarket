"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import PeriodChips from "@/components/admin/PeriodChips";
import { setOrderStatusAsSeller } from "@/lib/actions/seller-orders";
import { money, nowIso, addrLine, flowFor, FLOW } from "@/lib/utils";
import {
  filterSellerOrders, sellerFilterIsActive, sellerOrderKpis, sellerFlagCounts,
  SELLER_ORDER_FLAGS, SELLER_PAY_STATUSES,
  type SellerOrderFilter,
} from "@/lib/sellerOrderBook";
import { type PeriodPreset } from "@/lib/sales";
import { useRowCap } from "@/lib/useRowCap";
import { t } from "@/lib/i18n";
import type { SellerOrderView } from "@/lib/data/seller";
import type { Lang, OrderStatus, PayStatus } from "@/lib/types";

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
export default function SellerOrdersList({
  lang, orders, commissionRatePercent, today,
}: {
  lang: Lang;
  orders: SellerOrderView[];
  commissionRatePercent: number;
  /** Today, from the server, in the shop's timezone. Never the viewer's
   * clock: a seller on a skewed device -- or simply abroad -- would
   * otherwise get a different "today" than the figures they are reading. */
  today: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const [f, setF] = useState<SellerOrderFilter>({});
  const [preset, setPreset] = useState<PeriodPreset | null>(null);

  const set = (patch: Partial<SellerOrderFilter>) => setF((s) => ({ ...s, ...patch }));
  /** A hand-typed date means no preset is chosen any more. Kept separate
   * from set() because the chips write the same two fields and must not
   * clear the choice they just made. */
  const setDates = (patch: Partial<SellerOrderFilter>) => { setPreset(null); set(patch); };
  const clear = () => { setPreset(null); setF({}); };

  /* Two sets on purpose, the same discipline as the owner's order book:
     the flag chips count over the DATE WINDOW only, so their numbers do
     not collapse to "the one you clicked" the moment you click it. */
  const inWindow = useMemo(
    () => filterSellerOrders(orders, { from: f.from, to: f.to }, today),
    [orders, f.from, f.to, today]
  );
  const rows = useMemo(() => filterSellerOrders(orders, f, today), [orders, f, today]);
  const kpis = useMemo(() => sellerOrderKpis(rows, today), [rows, today]);
  const counts = useMemo(() => sellerFlagCounts(inWindow, today), [inWindow, today]);
  const active = sellerFilterIsActive(f);

  /* TWO ORDERS, THEN IT SCROLLS -- measured, not guessed.
   *
   * .list carries a stylesheet cap of --adm-item-h * --adm-max-items, which
   * is 63px * 5 -- the height of five of the ADMIN's compact rows. A seller's
   * order is not a row, it is a card several hundred pixels tall carrying its
   * lines, its money and its status buttons, so that cap left this page
   * showing about two thirds of one order in a scroller and the rest below
   * the fold of a box nobody could tell was a box.
   *
   * useRowCap measures the cards themselves and turns the fallback off
   * outright when they already fit, which is the case that matters most
   * here: a seller with one order should not be given a scrollbar. */
  const { ref: listRef, style: listStyle } = useRowCap<HTMLDivElement>(2, rows.length);

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
      <div className="page-head">
        <div><h1>{t("sellerOrders", lang)}</h1></div>
        <span className="hint">
          {counts.pending} {t("flag_pending", lang).toLowerCase()}
        </span>
      </div>

      {/* ---- the period, then the filters for it ----
          Laid out like the owner's order book on purpose: a seller who is
          also shown that screen, or who is talked through a problem over
          the phone by whoever runs the shop, should not be looking at a
          differently-shaped page. */}
      <div className="panel filters">
        <PeriodChips
          lang={lang} from={f.from} to={f.to} today={today} chosen={preset}
          onPick={(p, range) => { setPreset(p); set(range); }}
          onClear={() => { setPreset(null); set({ from: "", to: "" }); }}
        />

        <div className="bar">
          <input type="search" placeholder={t("searchSellerOrders", lang)}
            value={f.q || ""} onChange={(e) => set({ q: e.target.value })}
            style={{ flex: 1, minWidth: 170 }} />
          <input type="date" value={f.from || ""} aria-label={t("from", lang)}
            onChange={(e) => setDates({ from: e.target.value })} />
          <input type="date" value={f.to || ""} aria-label={t("to", lang)}
            onChange={(e) => setDates({ to: e.target.value })} />
          <select value={f.status || ""}
            onChange={(e) => set({ status: e.target.value as OrderStatus | "" })}>
            <option value="">{t("allStatuses", lang)}</option>
            {[...FLOW, "cancelled"].map((st) => (
              <option key={st} value={st}>{t("st_" + st, lang)}</option>
            ))}
          </select>
          <select value={f.payStatus || ""}
            onChange={(e) => set({ payStatus: e.target.value as PayStatus | "" })}>
            <option value="">{t("allPayStatuses", lang)}</option>
            {SELLER_PAY_STATUSES.map((ps) => (
              <option key={ps} value={ps}>{t("ps_" + ps, lang)}</option>
            ))}
          </select>
          <select value={f.mode || ""}
            onChange={(e) => set({ mode: e.target.value as "delivery" | "pickup" | "" })}>
            <option value="">{t("allModes", lang)}</option>
            <option value="delivery">{t("delivery", lang)}</option>
            <option value="pickup">{t("pickup", lang)}</option>
          </select>
          {active && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={clear}>
              {t("clearFilters", lang)}
            </button>
          )}
        </div>

        {/* ---- what needs this seller to do something ---- */}
        <div className="bar flag-bar">
          {SELLER_ORDER_FLAGS.map((flag) => (
            <button key={flag} type="button"
              className={"chip chip-count" + (f.flag === flag ? " is-on" : "")
                + (counts[flag] === 0 ? " is-empty" : "")}
              aria-pressed={f.flag === flag}
              onClick={() => set({ flag: f.flag === flag ? "" : flag })}>
              {t("flag_" + flag, lang)}
              <b>{counts[flag]}</b>
            </button>
          ))}
        </div>
      </div>

      {/* ---- the figures for whatever is selected ----
          THE SELLER'S MONEY, NOT THE SHOP'S. The owner's equivalent tiles
          show total revenue and what buyers still owe the shop; neither is
          this seller's to read. What they have is what their own lines sold
          for, what the marketplace keeps, and what is left. */}
      <div className="stat stat-fit ord-stat">
        <div>
          <b>{kpis.count}</b>
          <span>{t("orders", lang)}</span>
        </div>
        <div>
          <b>{money(kpis.grossSales)}</b>
          <span>{t("grossSales", lang)}</span>
        </div>
        <div>
          <b>-{money(kpis.commission)}</b>
          <span>{t("marketplaceCommission", lang)}</span>
        </div>
        <div className="is-good">
          <b>{money(kpis.earnings)}</b>
          <span>{t("sellerEarnings", lang)}</span>
        </div>
        <div>
          <b>{kpis.avgOrderValue == null ? "—" : money(kpis.avgOrderValue)}</b>
          <span>{t("avgOrderValue", lang)}</span>
        </div>
        <div>
          <b>{kpis.customers}</b>
          <span>{t("customers", lang)}</span>
        </div>
        <div>
          <b>{kpis.unfulfilled}</b>
          <span>{t("flag_unfulfilled", lang)}</span>
        </div>
        <div className={kpis.late > 0 ? "is-bad" : ""}>
          <b>{kpis.late}</b>
          <span>{t("flag_late", lang)}</span>
        </div>
      </div>

      {rows.length ? (
        <div className="list" ref={listRef} style={listStyle}>
          {rows.map((o) => {
            // The commission the LINES carry, worked out from the rate
            // each captured when it was placed (see OrderItem.commission_rate).
            // Recomputing it here from the current rate is what made a
            // renegotiation rewrite every past order on this screen.
            const commission = o.myCommission;
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
        /* TWO DIFFERENT NOTHINGS, and telling them apart is the whole
           point of saying anything here. "You have no orders yet" to a
           seller who has filtered down to an empty week is a lie that
           reads like a bug in their account; "nothing matches" to a seller
           who has never sold anything is a puzzle. */
        <div className="empty">
          <p>{t(orders.length ? "noResultsHere" : "noOrdersYet", lang)}</p>
          {orders.length > 0 && (
            <button type="button" className="btn btn-sm" onClick={clear}>
              {t("clearFilters", lang)}
            </button>
          )}
        </div>
      )}
    </>
  );
}
