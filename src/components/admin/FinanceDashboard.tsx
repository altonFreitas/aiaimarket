"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { ProfitBars, RankedBars } from "./Charts";
import WriteOnly from "./Access";
import {
  recordExpense, deleteExpense, addRecurring, endRecurring, confirmRecurring,
} from "@/lib/actions/expenses";
import {
  EXPENSE_ACCOUNTS, CADENCES, accountLabelKey, accountHintKey, annualCost,
  type Cadence,
} from "@/lib/accounts";
import type {
  ProfitAndLoss, ExpenseRow, RecurringRow, DueExpense, MonthlyPoint,
} from "@/lib/finance";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* THE ONE QUESTION THIS SCREEN ANSWERS.
 *
 * "After everything I pay to keep this running, how much is left?"
 *
 * Every other number in the admin is about merchandise. This one is about
 * the business, and it is laid out so the answer is readable in the first
 * two seconds: net profit at the top, then the arithmetic that produced it,
 * then what is still owed, then the detail.
 *
 * NOTHING IS ESTIMATED. A subscription becomes a cost when somebody
 * confirms the money left, not when a template says it should have.
 */

const today = () => new Date().toISOString().slice(0, 10);

function pct(n: number | null, digits = 1): string {
  return n == null ? "—" : `${(n * 100).toFixed(digits)}%`;
}

export default function FinanceDashboard({
  lang, ready, pl, expenses, recurring, due, committed, trend, runway,
}: {
  lang: Lang;
  ready: boolean;
  pl: ProfitAndLoss;
  expenses: ExpenseRow[];
  recurring: RecurringRow[];
  due: DueExpense[];
  committed: number;
  trend: MonthlyPoint[];
  runway: number | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"add" | "subscription" | null>(null);

  /* Above the early return below: a hook has to run on every render, and
     the "tables are missing" branch is still a render. */
  const byAccountRows = useMemo(() => pl.byAccount.map((a) => ({
    key: a.account,
    label: t(accountLabelKey(a.account), lang),
    value: a.total,
    share: a.share,
  })), [pl.byAccount, lang]);

  /* THE MIGRATION NOTICE COMES FIRST AND ALONE.
   *
   * A finance screen showing a profit of zero because the tables do not
   * exist is a screen that lies to the person who most needs it to be
   * right. So it shows nothing else at all until they do. */
  if (!ready) {
    return (
      <div className="panel">
        <h1>{t("finance", lang)}</h1>
        <div className="note bad" role="status">
          <b>{t("finNotReady", lang)}</b> {t("finNotReadyHint", lang)}
          <p style={{ margin: "8px 0 0" }}>
            <code>supabase/operating-costs.sql</code>
          </p>
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

  const profitable = pl.netProfit >= 0;

  return (
    <>
      {/* ---- the answer, before anything that explains it ---- */}
      <div className="panel">
        <div className="panel-head">
          <h1>{t("finance", lang)}</h1>
          <span className="hint">{t("finAllTime", lang)}</span>
        </div>

        <div className="fin-headline">
          <div className={"fin-net" + (profitable ? "" : " is-loss")}>
            <span className="k">{profitable ? t("finNetProfit", lang) : t("finNetLoss", lang)}</span>
            <b>{money(Math.abs(pl.netProfit))}</b>
            <span className="n">
              {pl.netMargin != null
                ? `${pct(pl.netMargin)} ${t("finOfIncome", lang)}`
                : t("finNoIncomeYet", lang)}
            </span>
          </div>

          <div className="fin-side">
            <div className="kv"><span>{t("finTotalIncome", lang)}</span><b>{money(pl.totalIncome)}</b></div>
            <div className="kv"><span>{t("finRunningCosts", lang)}</span><b>−{money(pl.expensesTotal)}</b></div>
            <div className="kv">
              <span>{t("finCommitted", lang)}</span>
              <b>{money(committed)}<small>/{t("finPerMonth", lang)}</small></b>
            </div>
            <div className="kv">
              <span>{t("finRunway", lang)}</span>
              <b>
                {runway == null
                  ? "—"
                  : `${runway.toFixed(1)} ${t("finMonths", lang)}`}
              </b>
            </div>
          </div>
        </div>

        {/* Said out loud rather than left for somebody to infer from a
            margin that looks suspiciously good. */}
        {pl.costCoverage < 0.99 && pl.ownSales > 0 && (
          <p className="note" style={{ marginTop: 12 }}>
            {t("finCoverageHint", lang).replace("{n}", pct(pl.costCoverage, 0))}
          </p>
        )}
      </div>

      {/* ---- what is owed and not yet paid ---- */}
      {due.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h3>{t("finDue", lang)}</h3>
            <span className="hint">{t("finDueHint", lang)}</span>
          </div>
          <ul className="fin-due">
            {due.map((d) => (
              <li key={`${d.recurring.id}|${d.periodStart}`}
                className={d.overdue ? "is-overdue" : ""}>
                <span className="fin-due-who">
                  <b>{d.recurring.vendor}</b>
                  <small>{t(accountLabelKey(d.recurring.account), lang)} · {d.periodStart}</small>
                </span>
                <span className="fin-due-amt">{money(d.recurring.amountUsd)}</span>
                <WriteOnly>
                  <button type="button" className="btn btn-sm btn-amber" disabled={busy}
                    onClick={() => run(() => confirmRecurring({
                      recurringId: d.recurring.id,
                      periodStart: d.periodStart,
                      periodEnd: d.periodEnd,
                      incurredOn: today(),
                    }), t("finConfirmed", lang))}>
                    {t("finConfirmPaid", lang)}
                  </button>
                </WriteOnly>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- the arithmetic ---- */}
      <div className="two-col">
        <div className="panel">
          <h3>{t("finStatement", lang)}</h3>
          <div className="fin-pl">
            <div className="fin-pl-group">{t("finIncome", lang)}</div>

            <div className="kv"><span>{t("finOwnSales", lang)}</span><b>{money(pl.ownSales)}</b></div>
            <div className="kv sub-row">
              <span>{t("finCostOfGoods", lang)}</span><b>−{money(pl.ownCost)}</b>
            </div>
            <div className="kv is-sum">
              <span>{t("finOwnGross", lang)}</span><b>{money(pl.ownGrossProfit)}</b>
            </div>

            <div className="kv"><span>{t("finCommission", lang)}</span><b>{money(pl.commission)}</b></div>
            <div className="kv"><span>{t("finDeliveryFees", lang)}</span><b>{money(pl.deliveryFees)}</b></div>
            {pl.refunds > 0 && (
              <div className="kv"><span>{t("finRefunds", lang)}</span><b>−{money(pl.refunds)}</b></div>
            )}

            <div className="kv is-total">
              <span>{t("finTotalIncome", lang)}</span><b>{money(pl.totalIncome)}</b>
            </div>

            <div className="fin-pl-group">{t("finCosts", lang)}</div>
            {pl.byAccount.map((a) => (
              <div className="kv" key={a.account}>
                <span>{t(accountLabelKey(a.account), lang)}</span>
                <b>−{money(a.total)}</b>
              </div>
            ))}
            {!pl.byAccount.length && (
              <p className="hint" style={{ margin: "4px 0" }}>{t("finNoCostsYet", lang)}</p>
            )}
            <div className="kv is-total">
              <span>{t("finRunningCosts", lang)}</span><b>−{money(pl.expensesTotal)}</b>
            </div>

            <div className={"kv is-net" + (profitable ? "" : " is-loss")}>
              <span>{profitable ? t("finNetProfit", lang) : t("finNetLoss", lang)}</span>
              <b>{money(pl.netProfit)}</b>
            </div>
          </div>

          {/* The marketplace's own size, reported next to the shop's trade
              so the two are not confused. Gross seller sales were never the
              shop's money -- only the commission above was. */}
          {pl.marketplaceGross > 0 && (
            <p className="hint" style={{ marginTop: 10 }}>
              {t("finMarketplaceGross", lang).replace("{v}", money(pl.marketplaceGross))}
            </p>
          )}
        </div>

        <div className="panel">
          <h3>{t("finWhereItGoes", lang)}</h3>
          <RankedBars rows={byAccountRows} emptyLabel={t("finNoCostsYet", lang)} />
          {pl.platformCost > 0 && (
            <p className="hint" style={{ marginTop: 10 }}>
              {t("finPlatformCost", lang).replace("{v}", money(pl.platformCost))}
            </p>
          )}
        </div>
      </div>

      {/* ---- the trend ---- */}
      <div className="panel">
        <h3>{t("finTrend", lang)}</h3>
        <ProfitBars
          points={trend.map((p) => ({
            key: p.month,
            label: p.month.slice(5),
            value: p.netProfit,
            title: `${p.month} · ${t("finIncome", lang)} ${money(p.income)} · ${t("finCosts", lang)} ${money(p.expenses)}`,
          }))}
          emptyLabel={t("noDataYet", lang)}
        />
      </div>

      {/* ---- recording things ---- */}
      <WriteOnly>
        <div className="panel">
          <div className="panel-head">
            <h3>{t("finRecord", lang)}</h3>
            <div className="btn-row" style={{ margin: 0 }}>
              <button type="button" className={"btn btn-sm" + (tab === "add" ? " btn-amber" : "")}
                onClick={() => setTab(tab === "add" ? null : "add")}>
                {t("finAddCost", lang)}
              </button>
              <button type="button" className={"btn btn-sm" + (tab === "subscription" ? " btn-amber" : "")}
                onClick={() => setTab(tab === "subscription" ? null : "subscription")}>
                {t("finAddSubscription", lang)}
              </button>
            </div>
          </div>

          {tab === "add" && (
            <ExpenseForm lang={lang} busy={busy}
              onSave={(v) => run(() => recordExpense(v), t("finSaved", lang))} />
          )}
          {tab === "subscription" && (
            <RecurringForm lang={lang} busy={busy}
              onSave={(v) => run(() => addRecurring(v), t("finSaved", lang))} />
          )}
        </div>
      </WriteOnly>

      {/* ---- what bills again ---- */}
      {recurring.length > 0 && (
        <div className="panel">
          <h3>{t("finSubscriptions", lang)}</h3>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>{t("finVendor", lang)}</th>
                  <th>{t("finAccount", lang)}</th>
                  <th>{t("finEvery", lang)}</th>
                  <th className="n">{t("finAmount", lang)}</th>
                  <th className="n">{t("finPerYear", lang)}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recurring.map((r) => {
                  const ended = !!r.endedOn;
                  return (
                    <tr key={r.id} className={ended ? "is-ended" : ""}>
                      <td>
                        <b>{r.vendor}</b>
                        {r.description ? <><br /><small className="sub">{r.description}</small></> : null}
                      </td>
                      <td>{t(accountLabelKey(r.account), lang)}</td>
                      <td>{t("cad_" + r.cadence, lang)}</td>
                      <td className="n">{money(r.amountUsd)}</td>
                      <td className="n">{money(annualCost(r.amountUsd, r.cadence))}</td>
                      <td className="n">
                        {ended ? (
                          <span className="sub">{t("finEnded", lang)} {r.endedOn}</span>
                        ) : (
                          <WriteOnly>
                            <button type="button" className="btn btn-sm btn-danger" disabled={busy}
                              onClick={() => run(() => endRecurring(r.id, today()), t("finStopped", lang))}>
                              {t("finStop", lang)}
                            </button>
                          </WriteOnly>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- the ledger ---- */}
      <div className="panel">
        <h3>{t("finLedger", lang)}</h3>
        {!expenses.length ? (
          <p className="hint">{t("finNoCostsYet", lang)}</p>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>{t("finDate", lang)}</th>
                  <th>{t("finVendor", lang)}</th>
                  <th>{t("finAccount", lang)}</th>
                  <th>{t("finCovers", lang)}</th>
                  <th className="n">{t("finAmount", lang)}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="mono">{e.incurredOn}</td>
                    <td>
                      <b>{e.vendor}</b>
                      {e.description ? <><br /><small className="sub">{e.description}</small></> : null}
                    </td>
                    <td>{t(accountLabelKey(e.account), lang)}</td>
                    <td className="sub">
                      {e.periodStart ? `${e.periodStart} → ${e.periodEnd ?? "…"}` : "—"}
                    </td>
                    <td className="n">{money(e.amountUsd)}</td>
                    <td className="n">
                      <WriteOnly>
                        <button type="button" className="btn btn-sm btn-danger" disabled={busy}
                          onClick={() => run(() => deleteExpense(e.id), t("finRemoved", lang))}>
                          {t("remove", lang)}
                        </button>
                      </WriteOnly>
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

/* ------------------------------------------------------------------ */

function AccountPicker({
  lang, value, onChange,
}: { lang: Lang; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor="acct">{t("finAccount", lang)}</label>
      <select id="acct" value={value} onChange={(e) => onChange(e.target.value)}>
        {EXPENSE_ACCOUNTS.map((a) => (
          <option key={a} value={a}>{t(accountLabelKey(a), lang)}</option>
        ))}
      </select>
      {/* A one-line hint under the picker, so somebody filing a cost knows
          which box it goes in without guessing from the name alone. */}
      <p className="hint">{t(accountHintKey(value), lang)}</p>
    </div>
  );
}

function ExpenseForm({
  lang, busy, onSave,
}: {
  lang: Lang; busy: boolean;
  onSave: (v: {
    account: string; vendor: string; description: string; amount: number;
    currency: string; fxRate: number; incurredOn: string; note: string;
  }) => void;
}) {
  const [account, setAccount] = useState("hosting");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [fxRate, setFxRate] = useState("1");
  const [incurredOn, setIncurredOn] = useState(today());
  const [note, setNote] = useState("");

  const usd = currency.toUpperCase() === "USD";

  return (
    <div className="fin-form">
      <AccountPicker lang={lang} value={account} onChange={setAccount} />
      <div className="two">
        <div className="field">
          <label htmlFor="vend">{t("finVendor", lang)}</label>
          <input id="vend" value={vendor} onChange={(e) => setVendor(e.target.value)}
            placeholder="Supabase" />
        </div>
        <div className="field">
          <label htmlFor="desc">{t("finDescription", lang)}</label>
          <input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <div className="two">
        <div className="field">
          <label htmlFor="amt">{t("finAmount", lang)}</label>
          <input id="amt" type="number" step="0.01" min="0" inputMode="decimal"
            value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cur">{t("finCurrency", lang)}</label>
          <input id="cur" value={currency} maxLength={8}
            onChange={(e) => setCurrency(e.target.value)} />
        </div>
      </div>
      {/* Only when it is needed. An exchange-rate box on every dollar cost
          is a box that gets a wrong number typed into it eventually. */}
      {!usd && (
        <div className="field">
          <label htmlFor="fx">{t("finFxRate", lang)}</label>
          <input id="fx" type="number" step="0.000001" min="0" inputMode="decimal"
            value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
          <p className="hint">{t("finFxHint", lang)}</p>
        </div>
      )}
      <div className="two">
        <div className="field">
          <label htmlFor="on">{t("finDate", lang)}</label>
          <input id="on" type="date" value={incurredOn}
            onChange={(e) => setIncurredOn(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="nte">{t("finNote", lang)}</label>
          <input id="nte" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div className="btn-row" style={{ margin: 0 }}>
        <button type="button" className="btn btn-amber" disabled={busy || !vendor.trim() || !amount}
          onClick={() => onSave({
            account, vendor, description,
            amount: Number(amount), currency,
            fxRate: usd ? 1 : Number(fxRate), incurredOn, note,
          })}>
          {busy ? "…" : t("finSaveCost", lang)}
        </button>
      </div>
    </div>
  );
}

function RecurringForm({
  lang, busy, onSave,
}: {
  lang: Lang; busy: boolean;
  onSave: (v: {
    account: string; vendor: string; description: string; amount: number;
    currency: string; fxRate: number; cadence: string; dayOfMonth: number;
    startedOn: string; note: string;
  }) => void;
}) {
  const [account, setAccount] = useState("hosting");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [fxRate, setFxRate] = useState("1");
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [startedOn, setStartedOn] = useState(today());

  const usd = currency.toUpperCase() === "USD";
  const n = Number(amount) || 0;

  return (
    <div className="fin-form">
      <p className="hint" style={{ margin: "0 0 10px" }}>{t("finSubHint", lang)}</p>
      <AccountPicker lang={lang} value={account} onChange={setAccount} />
      <div className="two">
        <div className="field">
          <label htmlFor="rvend">{t("finVendor", lang)}</label>
          <input id="rvend" value={vendor} onChange={(e) => setVendor(e.target.value)}
            placeholder="Vercel" />
        </div>
        <div className="field">
          <label htmlFor="rdesc">{t("finDescription", lang)}</label>
          <input id="rdesc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <div className="two">
        <div className="field">
          <label htmlFor="ramt">{t("finAmount", lang)}</label>
          <input id="ramt" type="number" step="0.01" min="0" inputMode="decimal"
            value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rcur">{t("finCurrency", lang)}</label>
          <input id="rcur" value={currency} maxLength={8}
            onChange={(e) => setCurrency(e.target.value)} />
        </div>
      </div>
      {!usd && (
        <div className="field">
          <label htmlFor="rfx">{t("finFxRate", lang)}</label>
          <input id="rfx" type="number" step="0.000001" min="0" inputMode="decimal"
            value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
        </div>
      )}
      <div className="two">
        <div className="field">
          <label htmlFor="cad">{t("finEvery", lang)}</label>
          <select id="cad" value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)}>
            {CADENCES.map((c) => (
              <option key={c} value={c}>{t("cad_" + c, lang)}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="dom">{t("finBillsOn", lang)}</label>
          {/* 1..28, so February is never a special case and a bill due on
              the 31st does not silently skip the short months. */}
          <input id="dom" type="number" min="1" max="28" inputMode="numeric"
            value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="from">{t("finStarting", lang)}</label>
        <input id="from" type="date" value={startedOn}
          onChange={(e) => setStartedOn(e.target.value)} />
      </div>
      {/* The number that makes "$25 a month" feel real. */}
      {n > 0 && (
        <p className="note" style={{ margin: "0 0 10px" }}>
          {t("finAnnualHint", lang).replace("{v}", money(annualCost(n, cadence)))}
        </p>
      )}
      <div className="btn-row" style={{ margin: 0 }}>
        <button type="button" className="btn btn-amber" disabled={busy || !vendor.trim() || !amount}
          onClick={() => onSave({
            account, vendor, description,
            amount: Number(amount), currency, fxRate: usd ? 1 : Number(fxRate),
            cadence, dayOfMonth: Number(dayOfMonth) || 1, startedOn, note: "",
          })}>
          {busy ? "…" : t("finSaveSubscription", lang)}
        </button>
      </div>
    </div>
  );
}

