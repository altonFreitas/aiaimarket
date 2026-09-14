"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { DualBars, RankedBars } from "../Charts";
import WriteOnly from "../Access";
import {
  recordSupplierReturn, recordSupplierCredit, closeSupplierReturn,
} from "@/lib/actions/supplier-returns";
import {
  SUPPLIER_RETURN_REASONS, returnReasonKey, supplierReasonKey, supplierStatusKey,
  isFaultReason,
  type CustomerReturnStats, type ReasonRow, type ReturnedProductRow,
  type CustomerReturnRow, type OpenRequestRow, type ReturnMonth,
  type SupplierReturnStats, type SupplierRankRow, type SupplierReturnRow,
} from "@/lib/returns";
import { money } from "@/lib/utils";
import { useRowCap } from "@/lib/useRowCap";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* WHAT CAME BACK.
 *
 * The shop could record a return and could not look at one. This screen is
 * the looking, and it is laid out around the two questions a shopkeeper
 * actually has:
 *
 *   is this normal?   a return rate, next to how much of it is the shop's
 *                     own fault. One number without the other is unreadable:
 *                     5% returns is healthy retail if it is people changing
 *                     their minds and an emergency if it is breakages.
 *   who owes me?      claims raised against suppliers and never chased. The
 *                     figure nobody keeps, and the one that is quietly
 *                     someone else's money sitting in the shop's loss.
 *
 * THE TWO DIRECTIONS ARE NEVER ADDED UP. A customer return costs the shop
 * money; a supplier return is money owed to it. A combined "returns" total
 * would be a number with no meaning, so no total here spans both.
 */

const today = () => new Date().toISOString().slice(0, 10);

function pct(n: number | null, digits = 1): string {
  return n == null ? "—" : `${(n * 100).toFixed(digits)}%`;
}

export interface SupplierHalf {
  ready: boolean;
  stats: SupplierReturnStats;
  bySupplier: SupplierRankRow[];
  chase: Array<SupplierReturnRow & { ageDays: number; outstanding: number }>;
  rows: SupplierReturnRow[];
  suppliers: Array<{ id: string; name: string }>;
  catalog: Array<{ id: string; name: string }>;
}

export default function ReturnsDashboard({
  lang, ready, stats, reasons, products, returns, openRequests, trend, supplier,
}: {
  lang: Lang;
  ready: boolean;
  stats: CustomerReturnStats;
  reasons: ReasonRow[];
  products: ReturnedProductRow[];
  returns: CustomerReturnRow[];
  openRequests: OpenRequestRow[];
  trend: ReturnMonth[];
  supplier: SupplierHalf | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [raising, setRaising] = useState(false);

  /* Above the early return: a hook has to run on every render, and the
     "tables are missing" branch is still a render. */
  const reasonRows = useMemo(() => reasons.map((r) => ({
    key: r.reason,
    label: t(returnReasonKey(r.reason), lang),
    value: r.count,
    share: r.share,
    meta: `${r.units} ${t("units", lang).toLowerCase()} · ${money(r.value)}`,
  })), [reasons, lang]);

  const productRows = useMemo(() => products.map((p) => ({
    key: p.productId,
    label: p.name,
    value: p.units,
    share: p.share,
    meta: p.scrapped > 0
      ? `${p.returns}× · ${p.scrapped} ${t("retScrapped", lang).toLowerCase()}`
      : `${p.returns}×`,
  })), [products, lang]);

  /* Five rows in each ledger, then it scrolls -- the same window the rest
     of the admin uses. Above the early return below, because a hook has to
     run on every render and "the tables are missing" is still one. */
  const { ref: retRef, style: retStyle } =
    useRowCap<HTMLDivElement>(5, returns.length);

  /* THE MIGRATION NOTICE COMES FIRST AND ALONE.
   *
   * A returns screen showing a return rate of 0% because supabase/returns
   * .sql was never applied is telling the shop its best possible news on no
   * evidence at all. So it shows nothing else until the table exists. */
  if (!ready) {
    return (
      <div className="panel">
        <h1>{t("returns", lang)}</h1>
        <div className="note bad" role="status">
          <b>{t("retNotReady", lang)}</b> {t("retNotReadyHint", lang)}
          <p style={{ margin: "8px 0 0" }}><code>supabase/returns.sql</code></p>
        </div>
      </div>
    );
  }

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      router.refresh();
    } catch (e) {
      toast(String((e as Error).message), true);
    }
    setBusy(false);
  };

  return (
    <>
      {/* ---- the customer side: is this normal? ---- */}
      <div className="panel">
        <div className="panel-head">
          <h1>{t("returns", lang)}</h1>
          <span className="hint">{t("retAllTime", lang)}</span>
        </div>

        <div className="ret-headline">
          <div className="ret-rate">
            <span className="k">{t("retRate", lang)}</span>
            <b>{pct(stats.returnRate)}</b>
            <span className="n">
              {stats.count} {t("retOfOrders", lang)}
            </span>
          </div>

          <div className="fin-side">
            <div className="kv"><span>{t("retUnitsBack", lang)}</span><b>{stats.units}</b></div>
            <div className="kv">
              <span>{t("retRefunded", lang)}</span><b>{money(stats.refundTotal)}</b>
            </div>
            <div className="kv">
              <span>{t("retBackOnShelf", lang)}</span><b>{pct(stats.restockRate, 0)}</b>
            </div>
            {/* The number that turns a rate into a diagnosis. */}
            <div className={"kv" + ((stats.faultRate ?? 0) > 0.5 ? " is-bad" : "")}>
              <span>{t("retOurFault", lang)}</span><b>{pct(stats.faultRate, 0)}</b>
            </div>
          </div>
        </div>

        {/* Money agreed and not yet gone. Said out loud because it is a
            liability the shop is carrying, not an accounting detail. */}
        {stats.refundPending > 0 && (
          <p className="note" style={{ marginTop: 12 }}>
            {t("retPendingHint", lang).replace("{v}", money(stats.refundPending))}
          </p>
        )}
      </div>

      {/* ---- buyers waiting for an answer ---- */}
      {openRequests.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h3>{t("retOpenRequests", lang)}</h3>
            <span className="hint">{t("retOpenRequestsHint", lang)}</span>
          </div>
          <ul className="fin-due">
            {openRequests.map((r) => (
              <li key={r.id}>
                <span className="fin-due-who">
                  <b>{r.ref}</b>
                  <small>
                    {t(returnReasonKey(r.reason), lang)} · {r.createdAt.slice(0, 10)}
                  </small>
                </span>
                <span className="fin-due-amt mono">{r.orderRef}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- why, and what ---- */}
      <div className="two-col">
        <div className="panel">
          <h3>{t("retWhy", lang)}</h3>
          <RankedBars
            rows={reasonRows}
            emptyLabel={t("retNothingBack", lang)}
            format={(n) => n.toLocaleString("en-US")}
          />
        </div>

        <div className="panel">
          <h3>{t("retMostReturned", lang)}</h3>
          <RankedBars
            rows={productRows}
            emptyLabel={t("retNothingBack", lang)}
            format={(n) => n.toLocaleString("en-US")}
          />
        </div>
      </div>

      {/* ---- both directions, over time ---- */}
      <div className="panel">
        <h3>{t("retTrend", lang)}</h3>
        <DualBars
          points={trend.map((m) => ({
            key: m.month, label: m.month.slice(5), a: m.customer, b: m.supplier,
          }))}
          labelA={t("retFromCustomers", lang)}
          labelB={t("retToSuppliers", lang)}
          emptyLabel={t("noDataYet", lang)}
        />
      </div>

      {/* ---- the supplier side: who owes me? ---- */}
      {supplier && (
        supplier.ready ? (
          <SupplierSection
            lang={lang} half={supplier} busy={busy} run={run}
            raising={raising} setRaising={setRaising}
          />
        ) : (
          <div className="panel">
            <h3>{t("retSupplier", lang)}</h3>
            <div className="note" role="status">
              <b>{t("retSupNotReady", lang)}</b> {t("retSupNotReadyHint", lang)}
              <p style={{ margin: "8px 0 0" }}><code>supabase/supplier-returns.sql</code></p>
            </div>
          </div>
        )
      )}

      {/* ---- every return, newest first ---- */}
      <div className="panel">
        <h3>{t("retLedger", lang)}</h3>
        {!returns.length ? (
          <p className="hint">{t("retNothingBack", lang)}</p>
        ) : (
          <div className="tw tw-cap" ref={retRef} style={retStyle}>
            <table>
              <thead>
                <tr>
                  <th>{t("retRef", lang)}</th>
                  <th>{t("order", lang)}</th>
                  <th>{t("retReason", lang)}</th>
                  <th className="n">{t("units", lang)}</th>
                  <th className="n">{t("retRefund", lang)}</th>
                  <th>{t("retSettled", lang)}</th>
                </tr>
              </thead>
              <tbody>
                {returns.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">
                      {r.ref}
                      <br />
                      <small className="sub">{r.createdAt.slice(0, 10)}</small>
                    </td>
                    <td>
                      <Link href={`/admin/o/${r.orderId}`} className="mono">
                        {r.orderRef || r.orderId.slice(0, 8)}
                      </Link>
                    </td>
                    <td>
                      <span className={"pill " + (isFaultReason(r.reason) ? "bad" : "muted")}>
                        {t(returnReasonKey(r.reason), lang)}
                      </span>
                      {r.note ? <><br /><small className="sub">{r.note}</small></> : null}
                    </td>
                    <td className="n">
                      {r.lines.reduce((a, l) => a + l.qty, 0)}
                      {r.lines.some((l) => !l.restock) && (
                        <><br /><small className="sub">{t("retScrapped", lang)}</small></>
                      )}
                    </td>
                    <td className="n">{money(r.refundTotal)}</td>
                    <td>
                      {r.refundedAt
                        ? <span className="mono sub">{r.refundedAt.slice(0, 10)}</span>
                        : <span className="pill warn">{t("retUnsettled", lang)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * The supplier half
 * ------------------------------------------------------------------------ */

function SupplierSection({
  lang, half, busy, run, raising, setRaising,
}: {
  lang: Lang;
  half: SupplierHalf;
  busy: boolean;
  run: (fn: () => Promise<unknown>, ok: string) => void;
  raising: boolean;
  setRaising: (v: boolean) => void;
}) {
  const s = half.stats;
  /* Five rows, then it scrolls, like every other ledger here. */
  const { ref: claimRef, style: claimStyle } =
    useRowCap<HTMLDivElement>(5, half.rows.length);
  const rows = useMemo(() => half.bySupplier.map((x) => ({
    key: x.supplierId,
    label: x.name,
    value: x.creditExpected,
    share: x.share,
    meta: `${x.returns}× · ${x.units} ${t("units", lang).toLowerCase()}`
      + (x.creditOutstanding > 0
        ? ` · ${money(x.creditOutstanding)} ${t("retOutstanding", lang).toLowerCase()}`
        : ""),
  })), [half.bySupplier, lang]);

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h3>{t("retSupplier", lang)}</h3>
          <WriteOnly>
            <button type="button"
              className={"btn btn-sm" + (raising ? " btn-amber" : "")}
              onClick={() => setRaising(!raising)}>
              {t("retRaiseClaim", lang)}
            </button>
          </WriteOnly>
        </div>

        <div className="ret-headline">
          <div className={"ret-rate" + (s.creditOutstanding > 0 ? " is-owed" : "")}>
            <span className="k">{t("retOwedToUs", lang)}</span>
            <b>{money(s.creditOutstanding)}</b>
            <span className="n">
              {s.awaiting} {t("retClaimsAwaiting", lang)}
            </span>
          </div>

          <div className="fin-side">
            <div className="kv"><span>{t("retClaims", lang)}</span><b>{s.count}</b></div>
            <div className="kv"><span>{t("retUnitsSent", lang)}</span><b>{s.units}</b></div>
            <div className="kv">
              <span>{t("retCreditReceived", lang)}</span><b>{money(s.creditReceived)}</b>
            </div>
            {/* How much of what the shop claimed it actually got back.
                A supplier relationship in one number. */}
            <div className={"kv" + ((s.recoveryRate ?? 1) < 0.5 ? " is-bad" : "")}>
              <span>{t("retRecovery", lang)}</span><b>{pct(s.recoveryRate, 0)}</b>
            </div>
          </div>
        </div>

        {s.rejected > 0 && (
          <p className="note" style={{ marginTop: 12 }}>
            {t("retRejectedHint", lang).replace("{n}", String(s.rejected))}
          </p>
        )}

        {raising && (
          <WriteOnly>
            <ClaimForm
              lang={lang} busy={busy}
              suppliers={half.suppliers} catalog={half.catalog}
              onSave={(v) => run(() => recordSupplierReturn(v), t("retClaimRaised", lang))}
            />
          </WriteOnly>
        )}
      </div>

      <div className="two-col">
        <div className="panel">
          <h3>{t("retBySupplier", lang)}</h3>
          <RankedBars rows={rows} emptyLabel={t("retNoClaims", lang)} />
        </div>

        {/* ---- claims sent and unanswered, OLDEST first ---- */}
        <div className="panel">
          <div className="panel-head">
            <h3>{t("retChase", lang)}</h3>
            <span className="hint">{t("retChaseHint", lang)}</span>
          </div>
          {!half.chase.length ? (
            <p className="hint">{t("retNothingToChase", lang)}</p>
          ) : (
            <ul className="fin-due">
              {half.chase.map((c) => (
                <li key={c.id} className={c.ageDays >= 30 ? "is-overdue" : ""}>
                  <span className="fin-due-who">
                    <b>{c.supplierName}</b>
                    <small>
                      {c.ref} · {c.ageDays} {t("retDaysOld", lang)}
                    </small>
                  </span>
                  <span className="fin-due-amt">{money(c.outstanding)}</span>
                  <WriteOnly>
                    <CreditButton
                      lang={lang} busy={busy} expected={c.outstanding}
                      onCredit={(amount) => run(
                        () => recordSupplierCredit({ returnId: c.id, amount }),
                        t("retCreditRecorded", lang))}
                      onReject={() => run(
                        () => closeSupplierReturn({ returnId: c.id, status: "rejected" }),
                        t("retClaimClosed", lang))}
                    />
                  </WriteOnly>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {half.rows.length > 0 && (
        <div className="panel">
          <h3>{t("retClaimLedger", lang)}</h3>
          <div className="tw tw-cap" ref={claimRef} style={claimStyle}>
            <table>
              <thead>
                <tr>
                  <th>{t("retRef", lang)}</th>
                  <th>{t("supplier", lang)}</th>
                  <th>{t("retReason", lang)}</th>
                  <th className="n">{t("retClaimed", lang)}</th>
                  <th className="n">{t("retCreditReceived", lang)}</th>
                  <th>{t("status", lang)}</th>
                </tr>
              </thead>
              <tbody>
                {half.rows.map((r) => (
                  <tr key={r.id} className={r.status === "cancelled" ? "is-ended" : ""}>
                    <td className="mono">
                      {r.ref}
                      <br />
                      <small className="sub">{r.shippedOn || r.createdAt.slice(0, 10)}</small>
                    </td>
                    <td>
                      {r.supplierName}
                      {r.poNumber ? <><br /><small className="sub mono">{r.poNumber}</small></> : null}
                    </td>
                    <td>{t(supplierReasonKey(r.reason), lang)}</td>
                    <td className="n">{money(r.creditExpectedUsd)}</td>
                    <td className="n">{money(r.creditReceivedUsd)}</td>
                    <td>
                      <span className={"pill " + STATUS_PILL[r.status]}>
                        {t(supplierStatusKey(r.status), lang)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

const STATUS_PILL: Record<string, string> = {
  draft: "muted", sent: "warn", credited: "ok", rejected: "bad", cancelled: "muted",
};

/** Recording what a supplier actually paid, in place, without a second
 * screen. The amount is pre-filled with what is outstanding, because that
 * is the answer nine times in ten and typing it again is how a digit goes
 * missing. */
function CreditButton({
  lang, busy, expected, onCredit, onReject,
}: {
  lang: Lang; busy: boolean; expected: number;
  onCredit: (amount: number) => void;
  onReject: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(expected));

  if (!open) {
    return (
      <button type="button" className="btn btn-sm btn-amber" disabled={busy}
        onClick={() => setOpen(true)}>
        {t("retMarkCredited", lang)}
      </button>
    );
  }

  return (
    <span className="ret-credit">
      <input type="number" step="0.01" min="0" inputMode="decimal"
        aria-label={t("retAmountReceived", lang)}
        value={amount} onChange={(e) => setAmount(e.target.value)} />
      <button type="button" className="btn btn-sm btn-amber" disabled={busy}
        onClick={() => { onCredit(Number(amount)); setOpen(false); }}>
        {t("save", lang)}
      </button>
      <button type="button" className="btn btn-sm btn-danger" disabled={busy}
        onClick={() => { onReject(); setOpen(false); }}>
        {t("retRejected", lang)}
      </button>
    </span>
  );
}

/* ------------------------------------------------------------------ */

interface ClaimLine {
  productId: string;
  productName: string;
  qty: string;
  unitCost: string;
  fromStock: boolean;
}

const BLANK_LINE: ClaimLine = {
  productId: "", productName: "", qty: "1", unitCost: "0", fromStock: true,
};

function ClaimForm({
  lang, busy, suppliers, catalog, onSave,
}: {
  lang: Lang;
  busy: boolean;
  suppliers: Array<{ id: string; name: string }>;
  catalog: Array<{ id: string; name: string }>;
  onSave: (v: {
    supplierId: string; reason: string; note: string;
    currency: string; fxRate: number; creditExpected: number;
    shippedOn: string;
    lines: Array<{
      productId: string | null; productName: string; qty: number;
      unitCost: number; fromStock: boolean;
    }>;
  }) => void;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || "");
  const [reason, setReason] = useState<string>("damaged");
  const [note, setNote] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [fxRate, setFxRate] = useState("1");
  const [shippedOn, setShippedOn] = useState(today());
  const [lines, setLines] = useState<ClaimLine[]>([{ ...BLANK_LINE }]);

  const usd = currency.toUpperCase() === "USD";

  const setLine = (i: number, patch: Partial<ClaimLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  /* What the shop is claiming, added up from the lines rather than typed.
     A total somebody types beside the lines that produced it is a second
     number that can disagree with them. */
  const claimed = lines.reduce(
    (a, l) => a + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);

  const usable = lines.filter(
    (l) => (Number(l.qty) || 0) > 0 && (l.productId || l.productName.trim()));

  if (!suppliers.length) {
    return <p className="hint" style={{ marginTop: 12 }}>{t("retNoSuppliers", lang)}</p>;
  }

  return (
    <div className="fin-form">
      <div className="two">
        <div className="field">
          <label htmlFor="sup">{t("supplier", lang)}</label>
          <select id="sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="srsn">{t("retReason", lang)}</label>
          <select id="srsn" value={reason} onChange={(e) => setReason(e.target.value)}>
            {SUPPLIER_RETURN_REASONS.map((r) => (
              <option key={r} value={r}>{t(supplierReasonKey(r), lang)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ---- the lines ---- */}
      <div className="ret-lines">
        {lines.map((l, i) => (
          <div className="ret-line" key={i}>
            <div className="field">
              <label htmlFor={`p${i}`}>{t("product", lang)}</label>
              <select id={`p${i}`} value={l.productId}
                onChange={(e) => {
                  const id = e.target.value;
                  setLine(i, {
                    productId: id,
                    productName: catalog.find((c) => c.id === id)?.name || l.productName,
                  });
                }}>
                {/* A line with no catalog product is allowed on purpose:
                    packaging and samples are bought, arrive faulty, and go
                    back, and none of them is a listing. */}
                <option value="">{t("retNotInCatalog", lang)}</option>
                {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {!l.productId && (
              <div className="field">
                <label htmlFor={`pn${i}`}>{t("retWhatWasIt", lang)}</label>
                <input id={`pn${i}`} value={l.productName}
                  onChange={(e) => setLine(i, { productName: e.target.value })} />
              </div>
            )}
            <div className="field is-narrow">
              <label htmlFor={`q${i}`}>{t("qty", lang)}</label>
              <input id={`q${i}`} type="number" step="1" min="1" inputMode="numeric"
                value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
            </div>
            <div className="field is-narrow">
              <label htmlFor={`c${i}`}>{t("retUnitCost", lang)}</label>
              <input id={`c${i}`} type="number" step="0.01" min="0" inputMode="decimal"
                value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} />
            </div>
            <label className="check">
              <input type="checkbox" checked={l.fromStock}
                onChange={(e) => setLine(i, { fromStock: e.target.checked })} />
              {t("retFromStock", lang)}
            </label>
            {lines.length > 1 && (
              <button type="button" className="btn btn-sm btn-danger"
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                {t("remove", lang)}
              </button>
            )}
          </div>
        ))}
        <button type="button" className="btn btn-sm"
          onClick={() => setLines((ls) => [...ls, { ...BLANK_LINE }])}>
          {t("retAddLine", lang)}
        </button>
      </div>
      <p className="hint">{t("retFromStockHint", lang)}</p>

      <div className="two">
        <div className="field">
          <label htmlFor="son">{t("retShippedOn", lang)}</label>
          <input id="son" type="date" value={shippedOn}
            onChange={(e) => setShippedOn(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="scur">{t("finCurrency", lang)}</label>
          <input id="scur" value={currency} maxLength={3}
            onChange={(e) => setCurrency(e.target.value)} />
        </div>
      </div>
      {!usd && (
        <div className="field">
          <label htmlFor="sfx">{t("finFxRate", lang)}</label>
          <input id="sfx" type="number" step="0.000001" min="0" inputMode="decimal"
            value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
          <p className="hint">{t("finFxHint", lang)}</p>
        </div>
      )}

      <div className="field">
        <label htmlFor="snote">{t("finNote", lang)}</label>
        <input id="snote" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <div className="kv is-total">
        <span>{t("retClaimed", lang)}</span><b>{money(claimed)}</b>
      </div>

      <div className="btn-row" style={{ margin: 0 }}>
        <button type="button" className="btn btn-amber"
          disabled={busy || !supplierId || !usable.length}
          onClick={() => onSave({
            supplierId, reason, note, currency,
            fxRate: usd ? 1 : Number(fxRate),
            creditExpected: claimed,
            shippedOn,
            lines: usable.map((l) => ({
              productId: l.productId || null,
              productName: l.productName,
              qty: Number(l.qty) || 0,
              unitCost: Number(l.unitCost) || 0,
              fromStock: l.fromStock,
            })),
          })}>
          {busy ? "…" : t("retRaiseClaim", lang)}
        </button>
      </div>
      {/* Said before the button is pressed, not after the shelf moves. */}
      <p className="hint">{t("retRaiseHint", lang)}</p>
    </div>
  );
}
