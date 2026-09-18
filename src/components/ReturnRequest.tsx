"use client";
import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";
import {
  requestReturn, returnableForBuyer, returnRequestsAvailable,
} from "@/lib/actions/return-requests";
import { t } from "@/lib/i18n";
import type { Lang, Order, OrderItem, ReturnReason } from "@/lib/types";

/* SENDING SOMETHING BACK, WITHOUT PHONING ANYBODY.
 *
 * Every return in this shop began with a phone call. The admin machinery
 * was all there and unreachable by the person holding the goods.
 *
 * This asks for two things and no more: which items, and why. It
 * deliberately does NOT ask what the refund should be -- that depends on
 * the delivery fee, on whether the goods come back saleable, and on
 * whatever gets agreed; letting a buyer type a number would either be
 * ignored, which is rude, or honoured, which is worse.
 */

const REASONS: ReturnReason[] = [
  "damaged", "wrong_item", "not_as_described", "changed_mind", "other",
];

const REASON_KEY: Record<ReturnReason, string> = {
  damaged: "retDamaged",
  wrong_item: "retWrongItem",
  not_as_described: "retNotAsDescribed",
  changed_mind: "retChangedMind",
  other: "retOther",
};

export default function ReturnRequest({
  order, phone, lang, onDone,
}: {
  order: Order;
  phone: string;
  lang: Lang;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [max, setMax] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  /* WHAT IS IN EACH BOX, AS TYPED.
     Strings, not numbers, for the reason the settings screen had to learn:
     Number("") is 0, so a handler that coerced every keystroke put a 0
     straight back the moment the box was emptied and the figure could not
     be deleted at all. A half-typed quantity is a string; it becomes a
     number once, where it is read. */
  const [qty, setQty] = useState<Record<string, string>>({});
  /** The whole number a box currently means, clamped to what is left to
   * return. An empty box means none of this line, which is the same thing
   * it meant before and is not a reason to refuse the submit. */
  /** How many of this line are still returnable. */
  const capOf = (i: OrderItem): number => max[i.product_id] ?? 0;
  const qtyOf = (productId: string, cap: number): number => {
    const n = Math.floor(Number(qty[productId]));
    return Number.isFinite(n) ? Math.max(0, Math.min(cap, n)) : 0;
  };
  const [reason, setReason] = useState<ReturnReason>("damaged");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  /* WHAT IS STILL SENDABLE, asked of the server rather than computed here.
   *
   * The browser holds the order's lines and could subtract, but it does
   * not know what a previous return already took back or what an open
   * request has already claimed -- and a form offering three of something
   * when one is left is a form that fails on submit for no visible
   * reason. */
  useEffect(() => {
    let alive = true;
    (async () => {
      const ok = await returnRequestsAvailable();
      if (!alive) return;
      setAvailable(ok);
      if (!ok) return;
      const allowed = await returnableForBuyer(order.ref, phone);
      if (alive) setMax(allowed);
    })();
    return () => { alive = false; };
  }, [order.ref, phone]);

  // Nothing to offer: the shop has not run the migration, the order has
  // not arrived, or every line has already been sent back.
  const arrived = ["arrived", "completed"].includes(order.status);
  const sendable = (order.items || []).filter(
    (i: OrderItem) => (max[i.product_id] ?? 0) > 0);
  if (available === false || !arrived || (available && !sendable.length)) return null;
  if (available === null) return null;

  const chosen = sendable.filter((i) => qtyOf(i.product_id, capOf(i)) > 0);

  async function send() {
    if (!chosen.length) {
      toast(t("retPickSomething", lang), true);
      return;
    }
    setBusy(true);
    try {
      const ref = await requestReturn({
        ref: order.ref,
        phone,
        reason,
        note,
        lines: chosen.map((i) => ({
          productId: i.product_id,
          productName: i.name,
          qty: qtyOf(i.product_id, capOf(i)),
        })),
      });
      toast(`${t("retSent", lang)} — ${ref}`);
      setOpen(false);
      setQty({});
      setNote("");
      onDone();
    } catch (e) {
      toast(String((e as Error).message), true);
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <div className="btn-row">
        <button className="btn btn-sm" type="button" onClick={() => setOpen(true)}>
          {t("retAsk", lang)}
        </button>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>{t("retAsk", lang)}</h3>
      <p className="sub">{t("retHint", lang)}</p>

      <ul className="ret-list">
        {sendable.map((i: OrderItem) => {
          const cap = capOf(i);
          const id = `ret-${i.product_id}`;
          return (
            <li key={i.product_id + i.size}>
              <label htmlFor={id}>
                <b>{i.name}</b>
                {i.size ? <span className="sub"> · {i.size}</span> : null}
                {/* Says the ceiling out loud rather than only enforcing it,
                    so somebody who bought three and returned one is not
                    left guessing why the box stops at two. */}
                <span className="sub"> · {t("retUpTo", lang).replace("{n}", String(cap))}</span>
              </label>
              <input
                id={id} type="number" inputMode="numeric"
                min={0} max={cap} value={qty[i.product_id] ?? ""}
                /* Clamped when it is READ, not on every keystroke: clamping
                   as you type rewrites the digit under the caret, so on a
                   cap of 3 the "1" of an intended "1" was fine but a
                   mistyped "12" became "3" before the 2 was even seen. */
                onChange={(e) =>
                  setQty((q) => ({ ...q, [i.product_id]: e.target.value }))}
                /* ...but the box settles to the figure that will actually
                   be sent as soon as it is left. Without this, somebody who
                   typed 12 with two left to return would see 12 in the box
                   and get two back, and only find out from the confirmation
                   -- the box would have quietly disagreed with the form. */
                onBlur={() => setQty((q) => {
                  const raw = q[i.product_id];
                  if (raw === undefined || raw.trim() === "") return q;
                  return { ...q, [i.product_id]: String(qtyOf(i.product_id, cap)) };
                })}
              />
            </li>
          );
        })}
      </ul>

      <div className="field">
        <label htmlFor="ret-reason">{t("retReason", lang)}</label>
        <select id="ret-reason" value={reason}
          onChange={(e) => setReason(e.target.value as ReturnReason)}>
          {REASONS.map((r) => (
            <option key={r} value={r}>{t(REASON_KEY[r], lang)}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="ret-note">{t("retNote", lang)}</label>
        <textarea id="ret-note" value={note} rows={3}
          onChange={(e) => setNote(e.target.value)} />
      </div>

      {/* Says what happens next. A request that vanishes into a form is
          indistinguishable from one that failed. */}
      <p className="sub">{t("retNext", lang)}</p>

      <div className="btn-row" style={{ margin: 0 }}>
        <button className="btn btn-amber" type="button" disabled={busy || !chosen.length}
          onClick={send}>
          {busy ? "…" : t("retSend", lang)}
        </button>
        <button className="btn btn-ghost" type="button" disabled={busy}
          onClick={() => setOpen(false)}>{t("cancel", lang)}</button>
      </div>
    </div>
  );
}
