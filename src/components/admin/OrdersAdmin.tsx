"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PeriodChips from "./PeriodChips";
import { BarSeries } from "./Charts";
import { money, nowIso, FLOW } from "@/lib/utils";
import {
  filterOrders, orderFilterIsActive, orderKpis, flagCounts, sortOrders,
  municipalitiesIn, ordersByDay, isLate,
  ORDER_FLAGS, ORDER_SORTS, PAY_METHODS, PAY_STATUSES,
  type OrderFilter, type OrderSort,
} from "@/lib/orderBook";
import { type PeriodPreset } from "@/lib/sales";
import { useRowCap } from "@/lib/useRowCap";
import { t } from "@/lib/i18n";
import type { Lang, Order, OrderStatus, PayMethod, PayStatus, Settings } from "@/lib/types";
import { useToast } from "@/components/Toast";

/* THE ORDER BOOK.
 *
 * This was a list of every order ever placed behind one status dropdown --
 * fine at nine orders, useless at nine hundred. The questions a shopkeeper
 * opens this page with are all about a WINDOW and a STATE: what came in
 * today, who has not paid, which parcels are late, what did this customer
 * buy last time.
 *
 * So the shape is the sales dashboard's, because it is the same shape of
 * question and two screens in one admin should not be operated differently:
 * a period across the top, the figures for that period, then the filters,
 * then the list.
 *
 * ONE FILTERED SET FEEDS EVERYTHING. Every tile, the chart and the list all
 * read the same rows. A tile counting all orders above a list showing some
 * would be two numbers on one screen that disagree, with nothing saying why.
 */

const STATUS_PILL: Record<string, string> = {
  new: "muted", confirmed: "info", preparing: "info", out: "info",
  arrived: "ok", completed: "ok", cancelled: "bad",
};

const PAY_PILL: Record<string, string> = {
  paid: "ok", unpaid: "", deposit: "warn", refunded: "muted",
};

function pct(n: number | null): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}

/** The download arrow, in the shop's ink. Drawn rather than imported: one
 * more icon dependency for one glyph is not a trade worth making. */
function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

export default function OrdersAdmin({
  lang, orders, ordersToday, today, settings,
}: {
  lang: Lang;
  orders: Order[];
  /** The shop's own details, for the delivery note a row can print. */
  settings?: Settings;
  ordersToday: number;
  /** Today, from the server. Never the viewer's clock: an admin with a
   * skewed device would otherwise see a different "today" than the data,
   * which is the bug the old ordersToday count was written to avoid. */
  today: string;
}) {
  const { toast } = useToast();
  /** The order whose delivery note is being built, so its button can say so
   * and cannot be pressed twice while jsPDF loads. */
  const [slipFor, setSlipFor] = useState<string | null>(null);
  const [f, setF] = useState<OrderFilter>({});
  const [preset, setPreset] = useState<PeriodPreset | null>(null);
  const [sort, setSort] = useState<OrderSort>("newest");
  const [more, setMore] = useState(false);

  const set = (patch: Partial<OrderFilter>) => setF((s) => ({ ...s, ...patch }));
  /** A hand-typed date means no preset is selected any more. Separate from
   * set() rather than a condition inside it, because the chips write the
   * same two fields and must not clear the choice they just made. */
  const setDates = (patch: Partial<OrderFilter>) => { setPreset(null); set(patch); };
  const clear = () => { setPreset(null); setF({}); };

  /* Everything in the date window, before the other filters. Two sets on
     purpose: the flag chips count over this one, so their numbers do not
     collapse to "the one you clicked" the moment you click it. */
  const inWindow = useMemo(
    () => filterOrders(orders, { from: f.from, to: f.to }, today),
    [orders, f.from, f.to, today]
  );
  const rows = useMemo(() => filterOrders(orders, f, today), [orders, f, today]);
  const list = useMemo(() => sortOrders(rows, sort), [rows, sort]);

  const kpis = useMemo(() => orderKpis(rows, today), [rows, today]);
  const counts = useMemo(() => flagCounts(inWindow, today), [inWindow, today]);
  const municipalities = useMemo(() => municipalitiesIn(orders), [orders]);

  /* The daily shape, only when a window is set and short enough to draw.
     ordersByDay returns nothing past its cap rather than a truncated span,
     so "all time" simply has no chart instead of a misleading one. */
  const daily = useMemo(
    () => (f.from && f.to ? ordersByDay(rows, f.from, f.to) : []),
    [rows, f.from, f.to]
  );

  const active = orderFilterIsActive(f);

  /* Five rows, then it scrolls. Measured from the rows themselves rather
     than set in the stylesheet: an order row is 56px wide-screen and 83px
     once the pills wrap under the reference, and WHERE that happens moves
     with the content -- a long customer name brings it forward. No single
     number in CSS is right at every width. */
  const { ref: listRef, style: listStyle } = useRowCap<HTMLDivElement>(5, list.length);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("orders", lang)}</h1>
          <p className="sub">{t("ordersSub", lang)}</p>
        </div>
        <span className="hint">
          {ordersToday} {t("ordersToday", lang).toLowerCase()}
        </span>
      </div>

      {/* ---- the period, then the figures for it ---- */}
      <div className="panel filters">
        <PeriodChips
          lang={lang} from={f.from} to={f.to} today={today} chosen={preset}
          onPick={(p, range) => { setPreset(p); set(range); }}
          onClear={() => { setPreset(null); set({ from: "", to: "" }); }}
        />

        <div className="bar">
          <input type="search" placeholder={t("searchOrders", lang)}
            value={f.q || ""} onChange={(e) => set({ q: e.target.value })}
            style={{ flex: 1, minWidth: 170 }} />
          <input type="date" value={f.from || ""} aria-label={t("from", lang)}
            onChange={(e) => setDates({ from: e.target.value })} />
          <input type="date" value={f.to || ""} aria-label={t("to", lang)}
            onChange={(e) => setDates({ to: e.target.value })} />
          <select value={f.status || ""}
            onChange={(e) => set({ status: e.target.value as OrderStatus | "" })}>
            <option value="">{t("allStatuses", lang)}</option>
            {[...FLOW, "cancelled"].map((s) => (
              <option key={s} value={s}>{t("st_" + s, lang)}</option>
            ))}
          </select>
          <select value={f.payStatus || ""}
            onChange={(e) => set({ payStatus: e.target.value as PayStatus | "" })}>
            <option value="">{t("allPayStatuses", lang)}</option>
            {PAY_STATUSES.map((s) => (
              <option key={s} value={s}>{t("ps_" + s, lang)}</option>
            ))}
          </select>
          <button type="button" className="btn btn-sm"
            aria-expanded={more} onClick={() => setMore(!more)}>
            {t("moreFilters", lang)}
          </button>
          {active && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={clear}>
              {t("clearFilters", lang)}
            </button>
          )}
        </div>

        {/* The rest, folded away. Six dropdowns always on screen is a wall;
            these are the ones reached for occasionally. */}
        {more && (
          <div className="bar">
            <select value={f.payMethod || ""}
              onChange={(e) => set({ payMethod: e.target.value as PayMethod | "" })}>
              <option value="">{t("allPayMethods", lang)}</option>
              {PAY_METHODS.map((m) => (
                <option key={m} value={m}>{t("pm_" + m, lang)}</option>
              ))}
            </select>
            <select value={f.mode || ""}
              onChange={(e) => set({ mode: e.target.value as "delivery" | "pickup" | "" })}>
              <option value="">{t("allModes", lang)}</option>
              <option value="delivery">{t("delivery", lang)}</option>
              <option value="pickup">{t("pickup", lang)}</option>
            </select>
            <select value={f.municipality || ""}
              onChange={(e) => set({ municipality: e.target.value })}>
              <option value="">{t("allMunicipalities", lang)}</option>
              {municipalities.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as OrderSort)}>
              {ORDER_SORTS.map((s) => (
                <option key={s} value={s}>{t("sort_" + s, lang)}</option>
              ))}
            </select>
          </div>
        )}

        {/* ---- what needs somebody to do something ----
             Counted over the window before the flag itself is applied, so
             clicking one does not blank the others. */}
        <div className="bar flag-bar">
          {ORDER_FLAGS.map((flag) => (
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

      {/* ---- the figures for whatever is selected ---- */}
      <div className="stat stat-fit ord-stat">
        <div>
          <b>{kpis.count}</b>
          <span>{t("orders", lang)}</span>
        </div>
        <div>
          <b>{money(kpis.revenue)}</b>
          <span>{t("totalRevenue", lang)}</span>
        </div>
        <div>
          <b>{kpis.avgOrderValue == null ? "—" : money(kpis.avgOrderValue)}</b>
          <span>{t("avgOrderValue", lang)}</span>
        </div>
        <div>
          <b>{kpis.customers}</b>
          <span>{t("customers", lang)}</span>
        </div>
        <div className={kpis.unpaidValue > 0 ? "is-warn" : ""}>
          <b>{money(kpis.unpaidValue)}</b>
          <span>{t("owedToShop", lang)}</span>
          <em>{kpis.unpaid} {t("orders", lang).toLowerCase()}</em>
        </div>
        <div>
          <b>{kpis.unfulfilled}</b>
          <span>{t("flag_unfulfilled", lang)}</span>
        </div>
        <div className={kpis.late > 0 ? "is-bad" : ""}>
          <b>{kpis.late}</b>
          <span>{t("flag_late", lang)}</span>
        </div>
        <div>
          <b>{pct(kpis.fulfilmentRate)}</b>
          <span>{t("fulfilled", lang)}</span>
        </div>
      </div>

      {/* ---- the shape of the window ---- */}
      {daily.length > 1 && (
        <div className="panel">
          <h3>{t("ordersPerDay", lang)}</h3>
          <BarSeries
            points={daily.map((d) => ({
              label: d.day.slice(5),
              value: d.orders,
            }))}
            emptyLabel={t("noDataYet", lang)}
            format={(n) => String(Math.round(n))}
          />
        </div>
      )}

      {/* ---- the book itself ---- */}
      <div className="panel">
        <div className="panel-head">
          <h3>
            {f.customer
              ? `${list[0]?.buyer_name || t("customer", lang)} · ${f.customer}`
              : t("orderList", lang)}
          </h3>
          <span className="count">{list.length}</span>
        </div>

        {f.customer && (
          <p className="hint" style={{ marginTop: 0 }}>
            <button type="button" className="btn btn-sm btn-ghost"
              onClick={() => set({ customer: "" })}>
              {t("showAllCustomers", lang)}
            </button>
          </p>
        )}

        {list.length ? (
          <div className="list ord-list" ref={listRef} style={listStyle}>
            {list.map((o) => {
              const late = isLate(o, today);
              return (
                <div className={"item ord-item" + (late ? " is-late" : "")} key={o.id}>
                  <Link className="ord-main" href={`/admin/o/${o.id}`}>
                    <b>
                      {o.ref} · {o.buyer_name}
                      {/* The PRO prefix already says it, but a pill survives
                          being skim-read: a pre-order cannot be picked and
                          packed today, so it must not look like one that can. */}
                      {o.is_preorder && (
                        <span className="pill warn" style={{ marginLeft: 6 }}>
                          {t("preorderShort", lang)}
                        </span>
                      )}
                      {late && (
                        <span className="pill bad" style={{ marginLeft: 6 }}>
                          {t("flag_late", lang)}
                        </span>
                      )}
                    </b>
                    <span>
                      {nowIso(o.created_at)} · {money(o.total)} · {t("pm_" + o.pay_method, lang)}
                      {o.municipality ? ` · ${o.municipality}` : ""}
                      {o.cancel_requested_at ? " · ⚠ " + t("askCancel", lang) : ""}
                    </span>
                  </Link>

                  <div className="acts">
                    {/* Filters to this buyer rather than opening the order:
                        "what else has this person bought" is the question a
                        phone number on screen provokes, and it had no answer. */}
                    <button type="button" className="ord-phone"
                      title={t("filterToCustomer", lang)}
                      onClick={() => set({ customer: o.buyer_phone })}>
                      {o.buyer_phone}
                    </button>
                    <span className={"pill " + (PAY_PILL[o.pay_status] ?? "")}>
                      {t("ps_" + o.pay_status, lang)}
                    </span>
                    <span className={"pill " + (STATUS_PILL[o.status] ?? "warn")}>
                      {t("st_" + o.status, lang)}
                    </span>
                    {/* THE DELIVERY NOTE, FROM HERE.
                        Printing one meant opening the order, finding the
                        button, printing, and going back -- four steps per
                        parcel on the morning somebody is packing twenty.
                        The document is the same one the order page prints;
                        this is only a shorter way to ask for it.

                        jsPDF is imported ON THE CLICK, so a list of forty
                        orders does not carry a PDF library nobody on that
                        screen has asked for. */}
                    <button type="button" className="ord-dl" disabled={slipFor === o.id}
                      title={t("deliveryNote", lang)}
                      aria-label={`${t("deliveryNote", lang)} — ${o.ref}`}
                      onClick={async () => {
                        setSlipFor(o.id);
                        try {
                          const mod = await import("@/lib/pdfPackingSlip");
                          await mod.downloadPackingSlip(o, settings);
                        } catch (e) {
                          toast(String((e as Error).message), true);
                        }
                        setSlipFor(null);
                      }}>
                      <DownloadIcon />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty">
            <p>{active ? t("noResults", lang) : t("noOrdersYet", lang)}</p>
            {active && (
              <button type="button" className="btn btn-sm" onClick={clear}>
                {t("clearFilters", lang)}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
