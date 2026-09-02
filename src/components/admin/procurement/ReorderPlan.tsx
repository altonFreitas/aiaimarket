"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { groupBySupplier, toReorder, type ReplenishmentRow } from "@/lib/replenishment";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

const URGENCY_PILL: Record<ReplenishmentRow["urgency"], string> = {
  out: "bad", urgent: "bad", soon: "warn", ok: "muted",
};
const URGENCY_KEY: Record<ReplenishmentRow["urgency"], string> = {
  out: "reorderOut", urgent: "reorderUrgent", soon: "reorderSoon", ok: "reorderOk",
};

/** Rounded for reading. A rate of 0.8571428 a day is 0.9, and a rate of
 * 0.04 is "less than 0.1" rather than a decimal nobody can hold in mind. */
function rateText(r: number): string {
  if (r <= 0) return "—";
  if (r < 0.1) return "<0.1";
  return r.toFixed(1);
}

function coverText(days: number | null): string {
  if (days == null) return "—";
  if (days <= 0) return "0";
  return String(Math.floor(days));
}

/** The draft order this group becomes: the supplier, and one
 * "product:quantity" pair per line, which the purchase order form reads back
 * into its own lines. Built with URLSearchParams so a product id or a
 * supplier name can never break the link. */
function poHref(supplierId: string | null, rows: ReplenishmentRow[]): string {
  const q = new URLSearchParams();
  if (supplierId) q.set("supplier", supplierId);
  q.set("lines", rows.map((r) => `${r.productId}:${r.suggestedQty}`).join(","));
  return `/admin/procurement/po/new?${q}`;
}

export default function ReorderPlan({ lang, rows }: { lang: Lang; rows: ReplenishmentRow[] }) {
  const [showAll, setShowAll] = useState(false);

  const needed = useMemo(() => toReorder(rows), [rows]);
  const groups = useMemo(() => groupBySupplier(needed), [needed]);
  const totalUnits = needed.reduce((n, r) => n + r.suggestedQty, 0);
  const outNow = needed.filter((r) => r.urgency === "out").length;

  // Everything else, for the times the question is "is anything about to
  // move" rather than "what do I buy today".
  const resting = useMemo(
    () => rows.filter((r) => !needed.includes(r))
      .sort((a, b) => (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity)),
    [rows, needed]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("reorderPlan", lang)}</h1>
          <p className="sub">{t("reorderPlanSub", lang)}</p>
        </div>
      </div>

      {/* .stat is the grid, its children are the tiles -- the same shape the
          stock and sales screens use, so the row reads as one system. */}
      <div className="stat stat-fit">
        <div><b>{needed.length}</b><span>{t("reorderLines", lang)}</span></div>
        <div><b>{totalUnits}</b><span>{t("unitsToOrder", lang)}</span></div>
        <div>
          <b className={outNow ? "bad-text" : ""}>{outNow}</b>
          <span>{t("reorderOut", lang)}</span>
        </div>
        <div><b>{groups.length}</b><span>{t("suppliersToContact", lang)}</span></div>
      </div>

      {!needed.length ? (
        <div className="panel">
          <div className="empty"><p>{t("reorderNothing", lang)}</p></div>
        </div>
      ) : (
        groups.map((g) => (
          <div className="panel" key={g.supplierId || "none"}>
            <div className="panel-head">
              <h3>
                {g.supplierName || t("supplierUnknown", lang)}
                <span className="hint"> · {g.units} {t("units", lang)}</span>
              </h3>
              {/* Pre-filling the order is the point: the plan already knows
                  the products and the quantities, and retyping them is where
                  a plan stops being used. */}
              <Link className="btn btn-sm btn-primary" href={poHref(g.supplierId, g.rows)}>
                {t("createPurchaseOrder", lang)}
              </Link>
            </div>
            <ReorderTable lang={lang} rows={g.rows} />
          </div>
        ))
      )}

      {resting.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h3>{t("reorderResting", lang)}</h3>
            <button type="button" className="btn btn-sm btn-ghost"
              onClick={() => setShowAll(!showAll)}>
              {showAll ? t("hide", lang) : t("show", lang)} ({resting.length})
            </button>
          </div>
          {showAll && <ReorderTable lang={lang} rows={resting} />}
        </div>
      )}
    </>
  );
}

function ReorderTable({ lang, rows }: { lang: Lang; rows: ReplenishmentRow[] }) {
  return (
    <div className="scroll-x">
      <table className="tbl tbl-compact">
        <thead>
          <tr>
            <th>{t("product", lang)}</th>
            <th className="num">{t("onHand", lang)}</th>
            <th className="num">{t("onOrder", lang)}</th>
            <th className="num">{t("position", lang)}</th>
            <th className="num">{t("sellingPerDay", lang)}</th>
            <th className="num">{t("daysOfCover", lang)}</th>
            <th className="num">{t("reorderPoint", lang)}</th>
            <th className="num">{t("orderQty", lang)}</th>
            <th>{t("status", lang)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.productId} className={r.urgency === "out" || r.urgency === "urgent"
              ? "row-bad" : r.urgency === "soon" ? "row-warn" : ""}>
              <td>
                <Link className="stock-name" href={`/admin/p/${r.productId}`}>
                  <span>
                    <b>{r.name}</b>
                    <span className="stock-sub">
                      {r.ref}
                      {/* An assumed lead time is worth saying out loud: the
                          whole suggestion rests on it. */}
                      {!r.leadKnown && ` · ${t("leadAssumed", lang).replace("{n}", String(r.leadDays))}`}
                    </span>
                  </span>
                </Link>
              </td>
              <td className="num">{r.onHand}</td>
              <td className="num">{r.onOrder || "—"}</td>
              <td className="num">
                <b style={{ color: r.position <= 0 ? "var(--red)" : undefined }}>{r.position}</b>
                {r.promised > 0 && (
                  <span className="stock-sub">−{r.promised} {t("awaitingConfirmShort", lang)}</span>
                )}
              </td>
              <td className="num">{rateText(r.dailyRate)}</td>
              <td className="num">
                {coverText(r.daysOfCover)}
                {r.stockoutOn && <span className="stock-sub">{r.stockoutOn}</span>}
              </td>
              <td className="num hint">{Math.ceil(r.reorderPoint)}</td>
              <td className="num"><b>{r.suggestedQty || "—"}</b></td>
              <td>
                <span className={"pill " + URGENCY_PILL[r.urgency]}>
                  {t(URGENCY_KEY[r.urgency], lang)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
