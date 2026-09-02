"use client";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { placeholder } from "@/lib/placeholder";
import { money, nowIso } from "@/lib/utils";
import { sortStockRows, type StockReport, type StockRow, type StockSortKey } from "@/lib/stockReport";
import { t } from "@/lib/i18n";
import type { Lang, StockMovement, StockMovementReason } from "@/lib/types";

const STOCK_KEY = { in: "stockIn", low: "stockLow", out: "stockOut" } as const;

/** Which rows a filter chip shows. `attention` is the default view because a
 * stock screen is opened to find problems, not to browse a catalog. */
type View = "attention" | "all" | "out" | "low" | "dead" | "archived";

const COLUMNS: Array<{ key: StockSortKey; label: string; numeric: boolean }> = [
  { key: "name", label: "product", numeric: false },
  { key: "onHand", label: "onHand", numeric: true },
  { key: "available", label: "available", numeric: true },
  // On order sits beside Available on purpose: together they answer "do I
  // need to buy more", which is the question that brings someone here.
  { key: "onOrder", label: "onOrder", numeric: true },
  { key: "unitsSold", label: "unitsSold", numeric: true },
  { key: "stockValue", label: "stockValue", numeric: true },
  { key: "lastCost", label: "lastCost", numeric: true },
  { key: "lastReceived", label: "lastReceived", numeric: true },
  { key: "lastSold", label: "lastSold", numeric: true },
  { key: "views", label: "views", numeric: true },
];

export default function StockAdmin({ lang, report }: {
  lang: Lang;
  report: StockReport & { movements?: StockMovement[]; drift?: Map<string, number> };
}) {
  // Which row is showing its history. One at a time: two open drill-downs
  // push everything else off the screen and neither can be compared to the
  // other anyway.
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("attention");
  const [sort, setSort] = useState<StockSortKey>("urgency");
  const [desc, setDesc] = useState(true);

  /* Grouped once for the whole table rather than filtered per row on every
     render: a store with a few thousand movements would otherwise walk the
     entire ledger once per visible row, every time anything changed. */
  const movesByProduct = useMemo(() => {
    const m = new Map<string, StockMovement[]>();
    for (const mv of report.movements || []) {
      const list = m.get(mv.product_id);
      if (list) list.push(mv); else m.set(mv.product_id, [mv]);
    }
    return m;
  }, [report.movements]);

  const rows = useMemo(() => {
    let a = report.rows;

    // Archived listings are excluded from every view except their own. They
    // cannot be sold, so an archived zero-stock row is not a stock problem --
    // letting them sit in the list is what makes a real problem hard to spot.
    a = view === "archived" ? a.filter((r) => r.archived) : a.filter((r) => !r.archived);

    if (view === "attention") a = a.filter((r) => r.urgency > 0);
    else if (view === "out") a = a.filter((r) => r.stockStatus === "out" || r.onHand === 0);
    else if (view === "low") a = a.filter((r) => r.urgency === 1);
    else if (view === "dead") a = a.filter((r) => r.unitsSold === 0);

    if (q.trim()) {
      const s = q.trim().toLowerCase();
      a = a.filter((r) =>
        (r.name + " " + r.ref + " " + r.categoryName + " " + r.sellerName).toLowerCase().includes(s)
      );
    }
    return sortStockRows(a, sort, desc);
  }, [report.rows, view, q, sort, desc]);

  function toggleSort(key: StockSortKey) {
    if (key === sort) { setDesc(!desc); return; }
    setSort(key);
    // Numbers open biggest-first, names open A-Z: each is the order someone
    // actually wants the first time they click that column.
    setDesc(COLUMNS.find((c) => c.key === key)?.numeric ?? true);
  }

  const s = report.summary;
  const views: Array<[View, string, number]> = [
    ["attention", "needsAttention", report.rows.filter((r) => !r.archived && r.urgency > 0).length],
    ["all", "all", s.skus],
    ["out", "stockOut", s.outOfStock],
    ["low", "stockLow", s.lowStock],
    ["dead", "neverSold", s.neverSold],
    ["archived", "archived", report.rows.filter((r) => r.archived).length],
  ];

  return (
    <>
      <h1>{t("stockControl", lang)}</h1>

      <div className="stat stat-fit">
        <div><b>{s.skus}</b><span>{t("liveProducts", lang)}</span></div>
        <div><b>{s.unitsOnHand}</b><span>{t("unitsOnHand", lang)}</span></div>
        <div><b>{money(s.stockValue)}</b><span>{t("stockValue", lang)}</span></div>
        <div><b style={{ color: s.outOfStock ? "var(--red)" : undefined }}>{s.outOfStock}</b>
          <span>{t("stockOut", lang)}</span></div>
        <div><b style={{ color: s.lowStock ? "var(--amber-ink)" : undefined }}>{s.lowStock}</b>
          <span>{t("stockLow", lang)}</span></div>
        {/* Only shown when it is non-zero: a permanent "0 oversold" tile
            teaches people to stop reading the row it sits in. */}
        {s.oversold > 0 && (
          <div><b style={{ color: "var(--red)" }}>{s.oversold}</b><span>{t("oversold", lang)}</span></div>
        )}
      </div>

      {s.unitsAwaitingConfirm > 0 && (
        <p className="note" style={{ marginBottom: 12 }}>
          {t("awaitingConfirmHint", lang).replace("{n}", String(s.unitsAwaitingConfirm))}
        </p>
      )}

      <div className="bar">
        <input type="text" placeholder={t("search", lang)} value={q}
          onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 130 }} />
        {views.map(([v, key, n]) => (
          <button key={v} type="button" className={"chip stock-chip" + (view === v ? " is-on" : "")}
            onClick={() => setView(v)}>
            {t(key, lang)} <span className="n">{n}</span>
          </button>
        ))}
      </div>

      {!rows.length ? (
        <div className="empty">
          <p>{view === "attention" ? t("stockAllHealthy", lang) : t("noResults", lang)}</p>
          {view !== "all" && (
            <button className="btn btn-ghost" type="button" onClick={() => setView("all")}>
              {t("all", lang)}
            </button>
          )}
        </div>
      ) : (
        /* The table scrolls inside its own box rather than the page: on a
           phone the columns simply cannot all fit, and a horizontally
           scrolling PAGE breaks every other screen in the admin. */
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} className={c.numeric ? "num" : ""}
                    aria-sort={sort === c.key ? (desc ? "descending" : "ascending") : "none"}>
                    <button type="button" onClick={() => toggleSort(c.key)}>
                      {t(c.label, lang)}
                      <span className="sort-caret">{sort === c.key ? (desc ? "▾" : "▴") : ""}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <StockRowView r={r} lang={lang}
                    drift={report.drift?.get(r.id) ?? 0}
                    open={openRow === r.id}
                    onToggle={() => setOpenRow(openRow === r.id ? null : r.id)} />
                  {openRow === r.id && (
                    <tr className="detail-row">
                      <td colSpan={COLUMNS.length}>
                        <MovementHistory lang={lang} moves={movesByProduct.get(r.id) || []}
                          onHand={r.onHand} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function StockRowView({ r, lang, drift, open, onToggle }: {
  r: StockRow; lang: Lang; drift: number; open: boolean; onToggle: () => void;
}) {
  return (
    <tr className={(r.urgency >= 3 ? "row-bad" : r.urgency === 1 ? "row-warn" : "")
      + (open ? " is-open" : "")}
      onClick={onToggle} style={{ cursor: "pointer" }}>
      <td>
        <Link className="stock-name" href={`/admin/p/${r.id}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="th" src={r.image || placeholder(r.name)} alt="" loading="lazy" />
          <span>
            <b>{open ? "▾ " : "▸ "}{r.name}</b>
            <span className="stock-sub">
              {r.ref}
              {r.categoryName ? ` · ${r.categoryName}` : ""}
              {r.sellerName ? ` · ${r.sellerName}` : ""}
            </span>
          </span>
        </Link>
      </td>
      <td className="num">
        <span className={"stock-btn s-" + r.stockStatus}>{t(STOCK_KEY[r.stockStatus], lang)}</span>
        <b className="stock-qty">{r.onHand}</b>
        {/* The balance and its ledger disagree. After stock-ledger.sql this
            should never appear; if it does, something wrote products.qty
            without leaving a movement and the count cannot be trusted. */}
        {drift !== 0 && (
          <span className="stock-sub" style={{ color: "var(--red)" }}
            title={t("stockDriftHint", lang)}>
            {t("stockDrift", lang)} {drift > 0 ? "+" : ""}{drift}
          </span>
        )}
      </td>
      <td className="num">
        {/* Negative means more has been promised than is held. Red, because
            it is the one number on this screen that means someone is about
            to be told their order cannot be filled. */}
        <b style={{ color: r.available < 0 ? "var(--red)" : undefined }}>{r.available}</b>
        {r.awaitingConfirm > 0 && (
          <span className="stock-sub" title={t("awaitingConfirm", lang)}>
            −{r.awaitingConfirm} {t("awaitingConfirmShort", lang)}
          </span>
        )}
      </td>
      <td className="num">
        {/* Zero and "not known" look identical in a number column, so an
            em dash is used when the purchase ledger is not set up. */}
        {r.onOrder == null ? "—" : (
          r.onOrder > 0
            ? <b style={{ color: "var(--green)" }}>+{r.onOrder}</b>
            : <span className="hint">0</span>
        )}
      </td>
      <td className="num">
        {r.unitsSold}
        {r.inFulfilment > 0 && (
          <span className="stock-sub">+{r.inFulfilment} {t("inFulfilmentShort", lang)}</span>
        )}
      </td>
      <td className="num">
        {money(r.stockValue)}
        {r.stockValueAtCost != null && (
          <span className="stock-sub">{money(r.stockValueAtCost)} {t("atCostShort", lang)}</span>
        )}
      </td>
      <td className="num">
        {r.lastCost == null ? "—" : money(r.lastCost)}
      </td>
      <td className="num">
        {r.lastReceived ? (
          <>
            <span suppressHydrationWarning>{r.lastReceived}</span>
            {r.lastSupplier && <span className="stock-sub">{r.lastSupplier}</span>}
          </>
        ) : <span className="hint">—</span>}
      </td>
      <td className="num">
        {r.lastSoldAt ? (
          <span title={nowIso(r.lastSoldAt)} suppressHydrationWarning>
            {r.daysSinceLastSale === 0 ? t("today", lang) : `${r.daysSinceLastSale}d`}
          </span>
        ) : (
          <span className="stock-sub">{t("never", lang)}</span>
        )}
      </td>
      <td className="num">{r.views}</td>
    </tr>
  );
}

const REASON_KEY: Record<StockMovementReason, string> = {
  purchase_receipt: "movementReceipt", sale: "movementSale",
  adjustment: "movementAdjustment", return: "movementReturn",
  correction: "movementCorrection",
};

/** Why the number is the number.
 *
 * Read oldest first and running to the balance on the right, because that is
 * the order the stock actually moved in -- a history that ends at the
 * opening balance answers nothing. */
function MovementHistory({ lang, moves, onHand }: {
  lang: Lang; moves: StockMovement[]; onHand: number;
}) {
  if (!moves.length) {
    return <p className="hint" style={{ margin: "6px 0" }}>{t("noMovements", lang)}</p>;
  }

  // Oldest first, with the balance carried forward. The ledger arrives
  // newest first because that is what every other screen wants.
  const withBalance = [...moves].reverse().reduce<Array<{ m: StockMovement; balance: number }>>(
    (acc, m) => {
      const previous = acc.length ? acc[acc.length - 1].balance : 0;
      acc.push({ m, balance: previous + Number(m.delta) });
      return acc;
    }, []);

  return (
    <div className="movements">
      <div className="movements-head">
        <b>{t("stockHistory", lang)}</b>
        <span className="hint">
          {withBalance.length} {t("movements", lang)} · {t("onHand", lang)} {onHand}
        </span>
      </div>
      <table className="tbl tbl-compact movements-tbl">
        <thead>
          <tr>
            <th>{t("date", lang)}</th>
            <th>{t("movement", lang)}</th>
            <th className="num">{t("change", lang)}</th>
            <th className="num">{t("balance", lang)}</th>
            <th>{t("note", lang)}</th>
          </tr>
        </thead>
        <tbody>
          {withBalance.map(({ m, balance }) => (
            <tr key={m.id}>
              <td>{nowIso(m.created_at)}</td>
              <td><span className={"pill mv-" + m.reason}>{t(REASON_KEY[m.reason], lang)}</span></td>
              <td className={"num " + (m.delta > 0 ? "up" : "down")}>
                {m.delta > 0 ? "+" : ""}{m.delta}
              </td>
              <td className="num"><b>{balance}</b></td>
              <td>
                {m.note || "—"}
                {m.unit_cost != null && (
                  <span className="stock-sub">{money(m.unit_cost)} {t("perUnit", lang)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
