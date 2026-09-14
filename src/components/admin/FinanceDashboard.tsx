"use client";
import { Fragment, useMemo, useState } from "react";
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
import { useRowCap } from "@/lib/useRowCap";
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

  /* WHICH COST LINES ARE OPENED OUT to show who was paid. An account is a
     filing cabinet, not an answer: "Software and licences $276" cannot be
     acted on, and "$276, all of it Supabase" can. */
  const [openAccounts, setOpenAccounts] = useState<string[]>([]);
  const toggleAccount = (a: string) =>
    setOpenAccounts((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));

  /* Eleven lines, then it scrolls. The dependency is the number of rows
     actually rendered, breakdown rows included -- opening one has to
     re-measure, or the window would stay sized for the closed statement. */
  const plLineCount =
    pl.byAccount.reduce(
      (n, a) => n + 1 + (openAccounts.includes(a.account) ? a.vendors.length : 0),
      0
    ) + (pl.refunds > 0 ? 1 : 0);
  const { ref: plRef, style: plStyle } = useRowCap<HTMLDivElement>(11, plLineCount);

  /* Live subscriptions first, stopped ones after -- a cancelled licence is
     history and should not sit between two things the shop still pays for.
     Within each group, biggest yearly commitment first: that is the order
     somebody reviewing what to cut wants to read them in. */
  const sortedRecurring = useMemo(() => [...recurring].sort((a, b) => {
    const ae = a.endedOn ? 1 : 0, be = b.endedOn ? 1 : 0;
    if (ae !== be) return ae - be;
    return annualCost(b.amountUsd, b.cadence) - annualCost(a.amountUsd, a.cadence);
  }), [recurring]);
  const yearlyCommitted = useMemo(
    () => recurring.filter((r) => !r.endedOn)
      .reduce((n, r) => n + annualCost(r.amountUsd, r.cadence), 0),
    [recurring]
  );
  const stoppedCount = recurring.filter((r) => r.endedOn).length;

  /* Five rows each, then they scroll. Measured from the rows rather than
     set in the stylesheet: a row carrying a description is taller than one
     without, so the height depends on the data. */
  const { ref: subRef, style: subStyle } =
    useRowCap<HTMLDivElement>(5, recurring.length);
  const { ref: ledgerRef, style: ledgerStyle } =
    useRowCap<HTMLDivElement>(5, expenses.length);

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

  /* The statement as a document. jspdf is imported here rather than at the
     top so it never reaches the first-load bundle -- the same arrangement
     every other PDF in this admin uses. The labels are resolved HERE, in
     the viewer's language, because lib/pdfProfitLoss has no business
     knowing which language anyone is reading in. */
  const savePdf = async () => {
    try {
      const { downloadProfitLossPdf } = await import("@/lib/pdfProfitLoss");
      downloadProfitLossPdf({
        pl,
        accountLabel: (a) => t(accountLabelKey(a), lang),
        labels: {
          title: t("finStatement", lang),
          income: t("finIncome", lang),
          ownSales: t("finOwnSales", lang),
          costOfGoods: t("finCostOfGoods", lang),
          ownGross: t("finOwnGross", lang),
          commission: t("finCommission", lang),
          deliveryFees: t("finDeliveryFees", lang),
          refunds: t("finRefunds", lang),
          totalIncome: t("finTotalIncome", lang),
          costs: t("finCosts", lang),
          runningCosts: t("finRunningCosts", lang),
          netProfit: t("finNetProfit", lang),
          netLoss: t("finNetLoss", lang),
          noVendor: t("finNoVendor", lang),
        },
      });
    } catch (e) {
      toast(String((e as Error).message), true);
    }
  };

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
          <div className="panel-head">
            <h3>{t("finStatement", lang)}</h3>
            <button type="button" className="btn btn-sm btn-ghost" onClick={savePdf}>
              <DownloadIcon /> {t("downloadPdf", lang)}
            </button>
          </div>

          {/* Eleven lines, then it scrolls -- and the count includes any
              breakdown rows opened below a cost, which is why it is counted
              here rather than assumed from pl.byAccount.length. */}
          <div className="fin-pl" ref={plRef} style={plStyle}>
            <div className="fin-pl-group">{t("finIncome", lang)}</div>

            <div className="kv"><span>{t("finOwnSales", lang)}</span><b>{money(pl.ownSales)}</b></div>
            <div className="kv sub-row">
              <span>{t("finCostOfGoods", lang)}</span>
              <b className="is-cost">−{money(pl.ownCost)}</b>
            </div>
            <div className="kv is-sum">
              <span>{t("finOwnGross", lang)}</span><b>{money(pl.ownGrossProfit)}</b>
            </div>

            <div className="kv"><span>{t("finCommission", lang)}</span><b>{money(pl.commission)}</b></div>
            <div className="kv"><span>{t("finDeliveryFees", lang)}</span><b>{money(pl.deliveryFees)}</b></div>
            {pl.refunds > 0 && (
              <div className="kv">
                <span>{t("finRefunds", lang)}</span>
                <b className="is-cost">−{money(pl.refunds)}</b>
              </div>
            )}

            <div className="kv is-total">
              <span>{t("finTotalIncome", lang)}</span><b>{money(pl.totalIncome)}</b>
            </div>

            <div className="fin-pl-group">{t("finCosts", lang)}</div>
            {pl.byAccount.map((a) => {
              const open = openAccounts.includes(a.account);
              /* An account with ONE vendor is not worth opening: the
                 breakdown would restate the line above it word for word.
                 The control is left out entirely rather than disabled --
                 a button that does nothing teaches people to stop
                 pressing buttons. */
              const splits = a.vendors.length > 1;
              return (
                <Fragment key={a.account}>
                  <div className={"kv is-cost-row" + (open ? " is-open" : "")}>
                    <span>
                      {splits ? (
                        <button type="button" className="fin-disclose"
                          aria-expanded={open}
                          aria-label={t("finWhoTo", lang).replace(
                            "{a}", t(accountLabelKey(a.account), lang))}
                          onClick={() => toggleAccount(a.account)}>
                          <Caret open={open} />
                          {t(accountLabelKey(a.account), lang)}
                          <em>{a.vendors.length}</em>
                        </button>
                      ) : (
                        <span className="fin-flat">
                          {t(accountLabelKey(a.account), lang)}
                          {/* One vendor, so its name IS the account's
                              answer and costs nothing to show inline. */}
                          {a.vendors[0]?.vendor
                            ? <em>{a.vendors[0].vendor}</em> : null}
                        </span>
                      )}
                    </span>
                    <b className="is-cost">−{money(a.total)}</b>
                  </div>
                  {open && a.vendors.map((v) => (
                    <div className="kv is-vendor" key={a.account + "|" + v.vendor}>
                      <span>{v.vendor || t("finNoVendor", lang)}</span>
                      <b className="is-cost">−{money(v.total)}</b>
                    </div>
                  ))}
                </Fragment>
              );
            })}
            {!pl.byAccount.length && (
              <p className="hint" style={{ margin: "4px 0" }}>{t("finNoCostsYet", lang)}</p>
            )}
            <div className="kv is-total">
              <span>{t("finRunningCosts", lang)}</span>
              <b className="is-cost">−{money(pl.expensesTotal)}</b>
            </div>

            {/* A loss reads "Net loss  −$586.30", never "$-586.30": money()
                puts the sign inside the currency, which looks like a typo
                where it matters most. The label already says which it is,
                so the figure carries its magnitude and a leading minus --
                the same shape as every cost line above it. */}
            <div className={"kv is-net" + (profitable ? "" : " is-loss")}>
              <span>{profitable ? t("finNetProfit", lang) : t("finNetLoss", lang)}</span>
              <b>{profitable ? money(pl.netProfit) : `−${money(Math.abs(pl.netProfit))}`}</b>
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
          {/* Eight bars, then it scrolls -- and the panel is held to the
              statement's height beside it, so the pair reads as one block
              rather than two boxes of different sizes. */}
          <RankedBars rows={byAccountRows} emptyLabel={t("finNoCostsYet", lang)}
            limit={EXPENSE_ACCOUNTS.length} maxRows={8} />
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
          <div className="panel-head">
            <h3>{t("finSubscriptions", lang)}</h3>
            {/* What the live ones add up to a year, said once at the top.
                It is the figure somebody opens this table to work out, and
                adding a column of yearly amounts in your head is the
                arithmetic the screen should have done. */}
            <span className="hint">
              {t("finPerYear", lang)}: <b className="mono">{money(yearlyCommitted)}</b>
              {stoppedCount > 0 && (
                <> · {stoppedCount} {t("finEnded", lang).toLowerCase()}</>
              )}
            </span>
          </div>
          <div className="tw fin-tbl" ref={subRef} style={subStyle}>
            <table>
              <thead>
                <tr>
                  <th>{t("finVendor", lang)}</th>
                  <th>{t("finAccount", lang)}</th>
                  <th>{t("finEvery", lang)}</th>
                  <th className="n">{t("finAmount", lang)}</th>
                  <th className="n">{t("finPerYear", lang)}</th>
                  <th className="n">{t("status", lang)}</th>
                </tr>
              </thead>
              <tbody>
                {sortedRecurring.map((r) => {
                  const ended = !!r.endedOn;
                  return (
                    <tr key={r.id} className={ended ? "is-ended" : ""}>
                      <td>
                        <span className="fin-who">
                          <b>{r.vendor}</b>
                          {r.description
                            ? <small className="sub">{r.description}</small> : null}
                        </span>
                      </td>
                      <td><span className="pill muted">{t(accountLabelKey(r.account), lang)}</span></td>
                      <td className="sub">{t("cad_" + r.cadence, lang)}</td>
                      <td className="n mono">{money(r.amountUsd)}</td>
                      {/* The yearly figure is the one that decides whether a
                          subscription is worth keeping, so it carries the
                          weight rather than the monthly one beside it. */}
                      <td className="n mono"><b>{money(annualCost(r.amountUsd, r.cadence))}</b></td>
                      <td className="n">
                        {ended ? (
                          <span className="sub mono">{r.endedOn}</span>
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
        <div className="panel-head">
          <h3>{t("finLedger", lang)}</h3>
          <span className="hint">
            {expenses.length} · <b className="mono">{money(pl.expensesTotal)}</b>
          </span>
        </div>
        {!expenses.length ? (
          <p className="hint">{t("finNoCostsYet", lang)}</p>
        ) : (
          <div className="tw fin-tbl" ref={ledgerRef} style={ledgerStyle}>
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
                    <td className="mono sub">{e.incurredOn}</td>
                    <td>
                      <span className="fin-who">
                        <b>{e.vendor}</b>
                        {e.description
                          ? <small className="sub">{e.description}</small> : null}
                      </span>
                    </td>
                    <td><span className="pill muted">{t(accountLabelKey(e.account), lang)}</span></td>
                    {/* The period a payment covers, which is the difference
                        between a month of hosting and a year of it. An
                        en dash for a one-off, not a blank: blank reads as
                        missing data rather than as "nothing to say". */}
                    <td className="sub mono">
                      {e.periodStart ? `${e.periodStart} → ${e.periodEnd ?? "…"}` : "–"}
                    </td>
                    <td className="n mono"><b>{money(e.amountUsd)}</b></td>
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


/* ------------------------------------------------------------------ */

/** The disclosure arrow on a cost line. currentColor and a rotation rather
 * than two glyphs, so it turns with the row and inherits its colour. */
function Caret({ open }: { open: boolean }) {
  return (
    <svg className={"fin-caret" + (open ? " is-open" : "")} viewBox="0 0 16 16"
      width="11" height="11" aria-hidden="true" focusable="false">
      <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"
      focusable="false" style={{ verticalAlign: "-2px", marginRight: 4 }}>
      <path d="M8 2v8m0 0L5 7m3 3l3-3M3 13h10" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
