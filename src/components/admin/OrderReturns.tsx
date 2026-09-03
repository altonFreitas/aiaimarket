"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { recordReturn } from "@/lib/actions/returns";
import { returnableQty } from "@/lib/sales";
import { money, nowIso } from "@/lib/utils";
import { t } from "@/lib/i18n";
import WriteOnly from "./Access";
import type { Lang, Order, OrderReturn, ReturnReason } from "@/lib/types";

const REASONS: ReturnReason[] = [
  "damaged", "wrong_item", "not_as_described", "changed_mind", "other",
];

/* Recording goods coming back, on the order they came back from.
 *
 * Not a screen of its own: a return is always about one order, and the
 * person recording it has that order open. The form only offers what the
 * order can still give back -- the same allowance the action enforces, so
 * the button can never propose a quantity the save will refuse. */
export default function OrderReturns({ lang, order, returns }: {
  lang: Lang; order: Order; returns: OrderReturn[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReturnReason>("changed_mind");
  const [note, setNote] = useState("");
  const [refund, setRefund] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});

  const already = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of returns) {
      for (const i of r.items || []) {
        if (!i.product_id) continue;
        m.set(i.product_id, (m.get(i.product_id) || 0) + Number(i.qty || 0));
      }
    }
    return m;
  }, [returns]);

  const allowance = useMemo(
    () => returnableQty(
      (order.items || []).map((i) => ({ product_id: i.product_id, qty: Number(i.qty) || 0 })),
      already),
    [order.items, already]);

  // One row per PRODUCT, not per order line: two sizes of one shirt are one
  // shelf, and the allowance is counted the same way.
  const rows = useMemo(() => {
    const seen = new Map<string, string>();
    for (const i of order.items || []) {
      if (i.product_id && !seen.has(i.product_id)) seen.set(i.product_id, i.name);
    }
    return [...seen.entries()]
      .map(([productId, name]) => ({ productId, name, max: allowance.get(productId) ?? 0 }))
      .filter((r) => r.max > 0);
  }, [order.items, allowance]);

  const refunded = returns.reduce((n, r) => n + Number(r.refund_total || 0), 0);

  async function submit() {
    const lines = rows
      .map((r) => ({
        productId: r.productId, productName: r.name,
        qty: Math.min(r.max, Math.floor(Number(qty[r.productId]) || 0)),
        restock: restock[r.productId] !== false,
      }))
      .filter((l) => l.qty > 0);
    if (!lines.length) { toast(t("returnNeedsALine", lang), true); return; }

    setBusy(true);
    try {
      const ref = await recordReturn({
        orderId: order.id, reason, note,
        refundTotal: Number(refund) || 0, lines,
      });
      toast(t("returnRecorded", lang) + " " + ref);
      setOpen(false); setQty({}); setRestock({}); setRefund(""); setNote("");
      startTransition(() => router.refresh());
    } catch (e) {
      toast(e instanceof Error ? e.message : t("error", lang), true);
    }
    setBusy(false);
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{t("returns", lang)}</h3>
        {rows.length > 0 && (
          <WriteOnly>
            <button type="button" className="btn btn-sm btn-ghost"
              onClick={() => setOpen(!open)} disabled={busy}>
              {open ? t("cancel", lang) : t("recordReturn", lang)}
            </button>
          </WriteOnly>
        )}
      </div>

      {returns.length > 0 && (
        <div className="scroll-x">
          <table className="tbl tbl-compact">
            <thead>
              <tr>
                <th>{t("date", lang)}</th><th>{t("reference", lang)}</th>
                <th>{t("reason", lang)}</th><th>{t("items", lang)}</th>
                <th className="num">{t("refund", lang)}</th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.id}>
                  <td>{nowIso(r.created_at)}</td>
                  <td className="mono">{r.ref}</td>
                  <td>{t("returnReason_" + r.reason, lang)}</td>
                  <td>
                    {(r.items || []).map((i) => (
                      <span key={i.id} className="stock-sub">
                        {i.qty} × {i.product_name}
                        {!i.restock && ` · ${t("notRestocked", lang)}`}
                      </span>
                    ))}
                  </td>
                  <td className="num">{money(r.refund_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {returns.length > 0 && (
        <p className="hint" style={{ margin: "8px 0 14px" }}>
          {t("refundedSoFar", lang)} {money(refunded)} / {money(order.total)}
        </p>
      )}

      {!returns.length && !open && (
        <p className="hint" style={{ margin: 0 }}>
          {rows.length ? t("noReturnsYet", lang) : t("nothingLeftToReturn", lang)}
        </p>
      )}

      {open && (
        <>
          <div className="two">
            <div className="field">
              <label htmlFor="ret-reason">{t("reason", lang)}</label>
              <select id="ret-reason" value={reason}
                onChange={(e) => setReason(e.target.value as ReturnReason)}>
                {REASONS.map((r) => (
                  <option key={r} value={r}>{t("returnReason_" + r, lang)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ret-refund">{t("refund", lang)}</label>
              <input id="ret-refund" type="number" min="0" step="0.01" value={refund}
                placeholder="0.00" onChange={(e) => setRefund(e.target.value)} />
              <p className="hint">{t("refundHint", lang)}</p>
            </div>
          </div>

          <div className="scroll-x">
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th>{t("product", lang)}</th>
                  <th className="num">{t("canReturn", lang)}</th>
                  <th className="num">{t("qty", lang)}</th>
                  <th>{t("backToStock", lang)}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.productId}>
                    <td>{r.name}</td>
                    <td className="num hint">{r.max}</td>
                    <td className="num">
                      <input type="number" min="0" max={r.max} step="1" className="qty-in"
                        value={qty[r.productId] || ""}
                        onChange={(e) => setQty({ ...qty, [r.productId]: e.target.value })} />
                    </td>
                    <td>
                      {/* Damaged goods come back into the building but not
                          onto the shelf. Defaulting to yes, because most
                          returns are sellable and the exception is the one
                          worth a deliberate click. */}
                      <label className="toggle">
                        <input type="checkbox" checked={restock[r.productId] !== false}
                          onChange={(e) =>
                            setRestock({ ...restock, [r.productId]: e.target.checked })} />
                        {" "}{t("sellable", lang)}
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="field">
            <label htmlFor="ret-note">{t("note", lang)}</label>
            <input id="ret-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          <div className="bar">
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
              {busy ? t("saving", lang) : t("recordReturn", lang)}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
