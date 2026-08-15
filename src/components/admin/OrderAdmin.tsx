"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { addOrderNote, editOrderNote, setOrderStatus, setPayStatus } from "@/lib/actions/orders";
import { addrLine, money, nowIso, waLink, flowFor } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Lang, Order, OrderStatus, PayStatus, Settings } from "@/lib/types";

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

export default function OrderAdmin({
  lang, order: o, settings,
}: { lang: Lang; order: Order; settings: Settings }) {
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  // Pickup orders skip the delivery-only steps ("out for delivery",
  // "arrived — calling you"), so the status buttons shown here match
  // whatever flow the order actually follows.
  const flow = flowFor(o.mode);
  const at = flow.indexOf(o.status);

  async function run(fn: () => Promise<unknown>, msg?: string) {
    setBusy(true);
    try { await fn(); if (msg) toast(msg); startTransition(() => router.refresh()); }
    catch (e) { toast(String((e as Error).message), true); }
    setBusy(false);
  }

  return (
    <>
      <p className="crumb">
        <Link href="/admin/orders">{t("orders", lang)}</Link> / {o.ref}
      </p>
      <h1>{o.buyer_name}</h1>
      <p className="sub mono" suppressHydrationWarning>{o.buyer_phone} · {nowIso(o.created_at)}</p>

      <div className="btn-row" style={{ flexDirection: "row", flexWrap: "wrap" }}>
        <a className="btn btn-wa btn-sm" target="_blank" rel="noopener"
          href={waLink(o.buyer_phone.replace(/[^\d]/g, ""), `Botardi ${o.buyer_name}! Kona-ba enkomenda ${o.ref}: `)}>
          WhatsApp
        </a>
        <a className="btn btn-ghost btn-sm" href={`tel:${o.buyer_phone}`}>{t("call", lang)}</a>
      </div>

      {/* F4 status machine */}
      <div className="panel">
        <h3>{t("markStatus", lang)}</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {flow.map((s, i) => (
            <button key={s} className={"btn btn-sm " + (i === at ? "btn-amber" : "btn-ghost")}
              disabled={busy || i < at || o.status === "cancelled"}
              onClick={() => run(() => setOrderStatus(o.id, s), t("st_" + s, lang))}>
              {o.mode === "pickup" && i === flow.length - 1 ? t("st_completed_pickup", lang) : t("st_" + s, lang)}
            </button>
          ))}
          <button className="btn btn-sm btn-danger" disabled={busy || ["completed", "cancelled"].includes(o.status)}
            onClick={() => run(() => setOrderStatus(o.id, "cancelled" as OrderStatus), t("st_cancelled", lang))}>
            {t("st_cancelled", lang)}
          </button>
        </div>
        {o.cancel_requested_at && (
          <p className="note" style={{ marginTop: 8 }}>
            {t("askCancel", lang)}: “{o.cancel_reason}”
          </p>
        )}
      </div>

      {/* G4 manual payment status */}
      <div className="panel">
        <h3>{t("paymentStatus", lang)}</h3>
        <div className="kv"><span>{t("payment", lang)}</span><b>{t("pm_" + o.pay_method, lang)}</b></div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {(["unpaid", "deposit", "paid", "refunded"] as PayStatus[]).map((s) => (
            <button key={s} className={"btn btn-sm " + (o.pay_status === s ? "btn-amber" : "btn-ghost")}
              disabled={busy} onClick={() => run(() => setPayStatus(o.id, s))}>
              {t("ps_" + s, lang)}
            </button>
          ))}
        </div>
        {o.proof_url && (
          <div style={{ marginTop: 10 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={o.proof_url} alt="proof"
              style={{ maxHeight: 220, border: "1px solid var(--line)", borderRadius: 6 }} />
          </div>
        )}
      </div>

      <div className="panel">
        <h3>{t("orderSummary", lang)}</h3>
        <div className="rows">
          {o.items.map((i, ix) => (
            <div className="kv" key={ix}>
              <span>{i.name}{i.size ? " · " + i.size : ""} × {i.qty}</span>
              <b>{money(i.price * i.qty)}</b>
            </div>
          ))}
          <div className="kv"><span>{t("deliveryFee", lang)}</span><b>{money(o.fee)}</b></div>
          <div className="kv total"><span>{t("total", lang)}</span><b>{money(o.total)}</b></div>
        </div>
        <div style={{ marginTop: 8 }} className="hint">
          {o.mode === "pickup" ? t("pickup", lang) : addrLine(o)}
        </div>
        {o.note && <div className="note info" style={{ marginTop: 8 }}>{o.note}</div>}
      </div>

      {/* F6 internal log */}
      <div className="panel">
        <h3>{t("internalLog", lang)}</h3>
        <ul className="log">
          {(o.order_log || []).slice().reverse().map((l) => {
            const isNote = l.text.trim().startsWith("* ");
            const isEditing = editingId === l.id;
            return (
              <li key={l.id}>
                <time>{nowIso(l.created_at)}</time>
                {isEditing ? (
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <input value={editText} onChange={(e) => setEditText(e.target.value)}
                      style={{ flex: 1, border: "1px solid var(--line)", borderRadius: 6, padding: 6 }} />
                    <button className="btn btn-sm" disabled={busy || !editText.trim()}
                      onClick={() => run(async () => {
                        await editOrderNote(o.id, l.id, editText);
                        setEditingId(null);
                      })}>
                      {t("save", lang)}
                    </button>
                    <button className="btn btn-sm btn-ghost" type="button" onClick={() => setEditingId(null)}>
                      {t("cancel", lang)}
                    </button>
                  </div>
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {l.text}
                    {isNote && (
                      <button type="button" className="log-edit-btn" aria-label={t("edit", lang)}
                        onClick={() => { setEditingId(l.id); setEditText(l.text.trim().slice(2)); }}>
                        <PencilIcon />
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={t("addNote", lang)}
            style={{ flex: 1, border: "1px solid var(--line)", borderRadius: 6, padding: 8 }} />
          <button className="btn btn-sm" disabled={busy || !note.trim()}
            onClick={() => run(async () => { await addOrderNote(o.id, note); setNote(""); })}>
            {t("add", lang)}
          </button>
        </div>
      </div>
    </>
  );
}
