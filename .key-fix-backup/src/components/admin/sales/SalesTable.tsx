"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/utils";
import {
  deliveryDelayDays, deliveryState, groupOrders, linesToCsv,
  type SalesLine,
} from "@/lib/sales";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* Sections 22 and 23: the transaction table, and the order detail that opens
 * underneath a row. One component, because the detail is the same data one
 * level down -- opening it in a modal would lose the reader's place in a
 * table they arrived at by filtering. */

const PAGE = 50;

type SortKey =
  | "date" | "ref" | "customer" | "product" | "qty"
  | "netSales" | "grossProfit" | "margin" | "status";

const COLUMNS: Array<{ key: SortKey; label: string; num?: boolean }> = [
  { key: "ref", label: "order" },
  { key: "date", label: "date" },
  { key: "customer", label: "customer" },
  { key: "product", label: "product" },
  { key: "qty", label: "qty", num: true },
  { key: "netSales", label: "netSales", num: true },
  { key: "grossProfit", label: "grossProfit", num: true },
  { key: "margin", label: "margin", num: true },
  { key: "status", label: "status", num: false },
];

const STATUS_PILL: Record<string, string> = {
  new: "muted", confirmed: "info", preparing: "info", out: "info",
  arrived: "ok", completed: "ok", cancelled: "bad",
};
const DELIVERY_PILL: Record<string, string> = {
  delivered_on_time: "ok", delivered_late: "warn", due: "info",
  delayed: "bad", no_date: "muted", cancelled: "muted",
};

function pct(n: number | null): string {
  return n == null ? "—" : `${(n * 100).toFixed(1)}%`;
}
function moneyOrDash(n: number | null): string {
  return n == null ? "—" : money(n);
}

export default function SalesTable({
  lang, lines, today,
}: { lang: Lang; lines: SalesLine[]; today: string }) {
  const [sort, setSort] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [openOrder, setOpenOrder] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const value = (l: SalesLine): string | number | null => {
      switch (sort) {
        case "date": return l.date;
        case "ref": return l.ref;
        case "customer": return l.customerName;
        case "product": return l.productName;
        case "qty": return l.qty;
        case "netSales": return l.netSales;
        case "grossProfit": return l.grossProfit;
        case "margin": return l.margin;
        case "status": return l.status;
      }
    };
    return [...lines].sort((a, b) => {
      const va = value(a), vb = value(b);
      // Unknowns (an uncosted line has no margin) sort last whichever way
      // the column is pointing -- an unknown is not a zero.
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb : String(va).localeCompare(String(vb));
      return asc ? cmp : -cmp;
    });
  }, [lines, sort, asc]);

  const shown = sorted.slice(0, limit);
  const orders = useMemo(() => new Map(groupOrders(lines).map((o) => [o.orderId, o])), [lines]);

  function toggleSort(key: SortKey) {
    if (key === sort) setAsc((v) => !v);
    else { setSort(key); setAsc(key === "ref" || key === "customer" || key === "product"); }
  }

  /** Export what is on screen, not the whole book: the reader has just
   * filtered this set down, and a CSV of everything would silently discard
   * that work. Built from the same lines the table renders. */
  function exportCsv() {
    const blob = new Blob([linesToCsv(sorted)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{t("salesTransactions", lang)}</h3>
        <div className="bar" style={{ margin: 0 }}>
          <span className="hint">{lines.length} {t("lines", lang)}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={exportCsv}
            disabled={!lines.length}>
            {t("exportCsv", lang)}
          </button>
        </div>
      </div>

      <div className="scroll-x">
        <table className="tbl tbl-compact">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className={c.num ? "num" : ""}>
                  <button type="button" className="th-sort" onClick={() => toggleSort(c.key)}>
                    {t(c.label, lang)}
                    {sort === c.key && <span aria-hidden="true">{asc ? " ▲" : " ▼"}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length ? shown.map((l, i) => {
              const order = orders.get(l.orderId);
              const isOpen = openOrder === l.orderId;
              return (
                <>
                  <tr key={l.orderId + l.productId + i}
                    className={isOpen ? "is-open" : ""}
                    onClick={() => setOpenOrder(isOpen ? null : l.orderId)}
                    style={{ cursor: "pointer" }}>
                    <td className="mono">{l.ref}</td>
                    <td className="mono">{l.date}</td>
                    <td>{l.customerName}</td>
                    <td>{l.productName}</td>
                    <td className="num">{l.qty}</td>
                    <td className="num">{money(l.netSales)}</td>
                    <td className="num">{moneyOrDash(l.grossProfit)}</td>
                    <td className="num">{pct(l.margin)}</td>
                    <td><span className={"pill " + STATUS_PILL[l.status]}>{t("st_" + l.status, lang)}</span></td>
                  </tr>
                  {isOpen && order && (
                    <tr key={l.orderId + "-detail"} className="detail-row">
                      <td colSpan={COLUMNS.length}>
                        <div className="order-detail">
                          <section>
                            <h4>{t("orderInformation", lang)}</h4>
                            <Kv label={t("order", lang)}
                              value={<Link href={`/admin/o/${order.orderId}`} className="mono">{order.ref}</Link>} />
                            <Kv label={t("orderDate", lang)} value={order.date} />
                            <Kv label={t("customer", lang)} value={`${order.customerName} · ${order.customerPhone}`} />
                            <Kv label={t("municipality", lang)} value={order.municipality || "—"} />
                            <Kv label={t("status", lang)}
                              value={<span className={"pill " + STATUS_PILL[order.status]}>{t("st_" + order.status, lang)}</span>} />
                          </section>

                          <section>
                            <h4>{t("financialInformation", lang)}</h4>
                            <Kv label={t("revenue", lang)} value={money(order.revenue)} />
                            <Kv label={t("cost", lang)} value={moneyOrDash(order.cost)} />
                            <Kv label={t("grossProfit", lang)} value={moneyOrDash(order.grossProfit)} />
                            <Kv label={t("margin", lang)} value={pct(order.margin)} />
                            <Kv label={t("paymentStatus", lang)} value={t("ps_" + order.payStatus, lang)} />
                            <Kv label={t("paymentMethod", lang)} value={t("pm_" + order.payMethod, lang)} />
                          </section>

                          <section>
                            <h4>{t("deliveryInformation", lang)}</h4>
                            <Kv label={t("expectedDelivery", lang)} value={order.expectedDelivery || "—"} />
                            <Kv label={t("actualDelivery", lang)} value={order.deliveredAt || "—"} />
                            <Kv label={t("invoiceDate", lang)} value={order.invoicedAt || "—"} />
                            <Kv label={t("deliveryStatus", lang)}
                              value={<span className={"pill " + DELIVERY_PILL[deliveryState(order, today)]}>
                                {t("dstate_" + deliveryState(order, today), lang)}
                              </span>} />
                            <Kv label={t("delayDays", lang)}
                              value={deliveryDelayDays(order, today) == null
                                ? "—" : `${deliveryDelayDays(order, today)}d`} />
                          </section>

                          <section className="order-detail-lines">
                            <h4>{t("productInformation", lang)}</h4>
                            <table className="tbl tbl-compact">
                              <thead>
                                <tr>
                                  <th>{t("product", lang)}</th><th>{t("category", lang)}</th>
                                  <th className="num">{t("qty", lang)}</th>
                                  <th className="num">{t("unitPrice", lang)}</th>
                                  <th className="num">{t("discount", lang)}</th>
                                  <th className="num">{t("netSales", lang)}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {order.lines.map((ol, k) => (
                                  <tr key={ol.productId + k}>
                                    <td>{ol.productName}</td>
                                    <td>{ol.categoryName || "—"}</td>
                                    <td className="num">{ol.qty}</td>
                                    <td className="num">{money(ol.unitPrice)}</td>
                                    <td className="num">{ol.discount ? money(ol.discount) : "—"}</td>
                                    <td className="num">{money(ol.netSales)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </section>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            }) : (
              <tr><td colSpan={COLUMNS.length} className="hint">{t("noResults", lang)}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {sorted.length > limit && (
        <button type="button" className="btn btn-sm btn-ghost"
          onClick={() => setLimit((n) => n + PAGE)} style={{ marginTop: 8 }}>
          {t("showMore", lang)} ({sorted.length - limit})
        </button>
      )}
    </div>
  );
}

function Kv({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="kv">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
