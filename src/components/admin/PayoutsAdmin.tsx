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

  async function save(sellerId: string) {
    setBusy(true);
    try {
      await recordPayout({ sellerId, amount: Number(amount), method, reference });
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
                        onChange={(e) => setMethod(e.target.value as PayoutMethod)}>
                        {METHODS.map((m) => (
                          <option key={m} value={m}>{t(METHOD_KEY[m], lang)}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor={`ref-${l.seller.id}`}>{t("payoutReference", lang)}</label>
                    <input id={`ref-${l.seller.id}`} value={reference}
                      onChange={(e) => setReference(e.target.value)} />
                  </div>
                  <div className="acts">
                    <button className="btn btn-sm btn-ghost" type="button"
                      onClick={() => setOpenFor(null)}>{t("cancel", lang)}</button>
                    <button className="btn btn-sm btn-amber" type="button" disabled={busy}
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
                  {p.reference ? ` · ${p.reference}` : ""}
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
