"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { recordPayout, deletePayout } from "@/lib/actions/payouts";
import { money, nowIso } from "@/lib/utils";
import { t } from "@/lib/i18n";
import WriteOnly from "./Access";
import type { SellerLedgerRow } from "@/lib/data/admin";
import type { Lang, PayoutMethod, SellerPayout } from "@/lib/types";

const METHODS: PayoutMethod[] = ["bank", "wallet", "cash", "other"];
const METHOD_KEY: Record<PayoutMethod, string> = {
  bank: "payoutMethodBank",
  wallet: "payoutMethodWallet",
  cash: "payoutMethodCash",
  other: "payoutMethodOther",
};

/** WHAT EACH METHOD LEAVES BEHIND.
 *
 * The form used to show one "Reference" box for all four, which asked the
 * wrong question twice over: a cash payout has no reference to give, and a
 * bank transfer was happily recorded without the one thing that makes it
 * checkable. Six months later the question is "did this $28.80 actually
 * leave the account", and for a transfer the only answer is the reference
 * the bank can be asked about.
 *
 * So: bank and wallet REQUIRE their reference, cash asks who took the money
 * instead (a note, not a reference -- it goes in a different column), and
 * "other" offers a reference without insisting, because nobody knows what
 * it is. recordPayout enforces the same rule server-side; this is only the
 * half that can say so before the button is pressed. */
const REFERENCE_LABEL: Record<PayoutMethod, string> = {
  bank: "payoutRefBank",
  wallet: "payoutRefWallet",
  cash: "payoutNoteCash",
  other: "payoutReference",
};
function referenceRequired(m: PayoutMethod): boolean {
  return m === "bank" || m === "wallet";
}

export default function PayoutsAdmin({
  lang, ledgers, payouts,
}: { lang: Lang; ledgers: SellerLedgerRow[]; payouts: SellerPayout[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayoutMethod>("bank");
  const [reference, setReference] = useState("");

  const storeNames = Object.fromEntries(ledgers.map((l) => [l.seller.id, l.seller.store_name]));
  const totalOwed = ledgers.reduce((a, l) => a + Math.max(0, l.outstanding), 0);
  const totalCommission = ledgers.reduce((a, l) => a + l.commission, 0);

  function open(l: SellerLedgerRow) {
    setOpenFor(l.seller.id);
    // Pre-filled with the full outstanding balance, which is what a payout
    // almost always is -- but editable, because part-payments happen.
    setAmount(l.outstanding > 0 ? l.outstanding.toFixed(2) : "");
    setMethod("bank");
    setReference("");
  }

  /** A method change clears the box. A bank reference typed and then
   * switched to Cash would otherwise ride along into a record that says the
   * money was handed over in person -- with a transfer number attached to
   * it. */
  function pickMethod(m: PayoutMethod) {
    setMethod(m);
    setReference("");
  }

  const amountValue = Number(amount);
  const amountOk = Number.isFinite(amountValue) && amountValue > 0;
  const referenceOk = !referenceRequired(method) || reference.trim() !== "";

  async function save(sellerId: string) {
    setBusy(true);
    try {
      // Cash has no reference; what it has is the person who took it, and
      // that is a note. Two columns, because they are two different facts.
      const isCash = method === "cash";
      await recordPayout({
        sellerId,
        amount: amountValue,
        method,
        reference: isCash ? "" : reference,
        note: isCash ? reference : "",
      });
      toast(t("payoutSaved", lang));
      setOpenFor(null);
      router.refresh();
    } catch (e) {
      toast(String((e as Error).message), true);
    }
    setBusy(false);
  }

  async function remove(id: string) {
    if (!window.confirm(t("deletePayoutAsk", lang))) return;
    setBusy(true);
    try {
      await deletePayout(id);
      router.refresh();
    } catch (e) {
      toast(String((e as Error).message), true);
    }
    setBusy(false);
  }

  return (
    <>
      <h1>{t("payouts", lang)}</h1>

      <div className="stat">
        <div><b>{ledgers.length}</b><span>{t("sellers", lang)}</span></div>
        <div><b>{money(totalOwed)}</b><span>{t("outstanding", lang)}</span></div>
        <div><b>{money(totalCommission)}</b><span>{t("marketplaceCommission", lang)}</span></div>
        <div><b>{money(ledgers.reduce((a, l) => a + l.paidOut, 0))}</b><span>{t("paidOut", lang)}</span></div>
      </div>

      {!ledgers.length ? (
        <div className="empty"><p>{t("noDataYet", lang)}</p></div>
      ) : (
        <div className="list">
          {ledgers.map((l) => (
            <div key={l.seller.id} className="item" style={{ flexWrap: "wrap" }}>
              <div className="g">
                <b>{l.seller.store_name}</b>
                <span>
                  {l.completedOrderCount} {t("orders", lang).toLowerCase()} ·{" "}
                  {t("grossSales", lang)} {money(l.grossSales)} ·{" "}
                  {t("commissionRate", lang)} {l.commissionRatePercent}%
                </span>
              </div>
              <div style={{ textAlign: "right", minWidth: 130 }}>
                <b className="mono" style={{
                  fontSize: 16,
                  // A negative balance means more has been paid than earned.
                  // Coloured, not hidden -- see computeSellerLedger.
                  color: l.outstanding < 0 ? "var(--red)" : undefined,
                }}>
                  {money(l.outstanding)}
                </b>
                <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>
                  {l.outstanding < 0 ? t("overpaid", lang) : t("outstanding", lang)}
                </span>
              </div>
              <WriteOnly>
                <div className="acts">
                  <button className="btn btn-sm btn-amber" type="button" disabled={busy}
                    onClick={() => open(l)}>
                    {t("recordPayout", lang)}
                  </button>
                </div>
              </WriteOnly>

              {openFor === l.seller.id && (
                <div style={{ flexBasis: "100%", borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 6 }}>
                  <div className="two">
                    <div className="field">
                      <label htmlFor={`amt-${l.seller.id}`}>{t("payoutAmount", lang)} (USD)</label>
                      <input id={`amt-${l.seller.id}`} type="number" min="0.01" step="0.01"
                        value={amount} onChange={(e) => setAmount(e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor={`mth-${l.seller.id}`}>{t("payoutMethod", lang)}</label>
                      <select id={`mth-${l.seller.id}`} value={method}
                        onChange={(e) => pickMethod(e.target.value as PayoutMethod)}>
                        {METHODS.map((m) => (
                          <option key={m} value={m}>{t(METHOD_KEY[m], lang)}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {amountOk && amountValue > l.outstanding && (
                    <p className="hint" style={{ color: "var(--red)" }}>
                      {t("payoutOverOwed", lang)} {money(l.outstanding)}
                    </p>
                  )}
                  <div className={"field" + (referenceOk ? "" : " err")}>
                    <label htmlFor={`ref-${l.seller.id}`}>{t(REFERENCE_LABEL[method], lang)}</label>
                    <input id={`ref-${l.seller.id}`} value={reference}
                      onChange={(e) => setReference(e.target.value)} />
                    <p className="hint">
                      {method === "cash" ? t("payoutNoteCashHint", lang)
                        : referenceRequired(method) ? t("payoutRefRequired", lang)
                        : t("payoutRefOptional", lang)}
                    </p>
                  </div>
                  <div className="acts">
                    <button className="btn btn-sm btn-ghost" type="button"
                      onClick={() => setOpenFor(null)}>{t("cancel", lang)}</button>
                    <button className="btn btn-sm btn-amber" type="button"
                      disabled={busy || !amountOk || !referenceOk}
                      onClick={() => save(l.seller.id)}>
                      {busy ? "…" : t("recordPayout", lang)}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: 20 }}>{t("payoutHistory", lang)}</h2>
      {!payouts.length ? (
        <p className="sub">{t("noPayoutsYet", lang)} {t("payoutsNeedMigration", lang)}</p>
      ) : (
        <div className="list">
          {payouts.map((p) => (
            <div key={p.id} className="item">
              <div className="g">
                <b>{storeNames[p.seller_id] || p.seller_id}</b>
                <span>
                  {nowIso(p.paid_at)} · {t(METHOD_KEY[p.method] || "payoutMethodOther", lang)}
                  {p.reference ? ` · ${p.reference}` : p.note ? ` · ${p.note}` : ""}
                </span>
              </div>
              <b className="mono">{money(p.amount)}</b>
              <WriteOnly>
                <div className="acts">
                  <button className="btn btn-sm btn-danger" type="button" disabled={busy}
                    onClick={() => remove(p.id)}>×</button>
                </div>
              </WriteOnly>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
