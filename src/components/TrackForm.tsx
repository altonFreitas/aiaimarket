"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useToast } from "@/components/Toast";
import {
  lookupOrder, getOrdersByPhone, requestCancellation, updateOrderAddress, uploadPaymentProof,
} from "@/lib/actions/orders";
import { compressImage } from "@/lib/compressImage";
import { downloadOrderInvoice } from "@/lib/pdfInvoice";
import { addrLine, money, nowIso, waLink, waOrderMsg, flowFor } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Lang, Order, Settings } from "@/lib/types";

interface OrderSummary {
  ref: string; buyer_name: string; buyer_phone: string;
  status: string; pay_status: string; total: number; created_at: string; mode: string;
}

export default function TrackForm({
  lang, initialRef, settings,
}: { lang: Lang; initialRef: string; settings?: Settings }) {
  const params = useSearchParams();
  const { toast } = useToast();
  const [ref, setRef] = useState(initialRef);
  const [phone, setPhone] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [history, setHistory] = useState<OrderSummary[] | null>(null);
  const [busy, setBusy] = useState(false);

  // Coming straight from checkout: the phone is passed once so the buyer
  // doesn't have to retype it to see the order they just placed.
  useEffect(() => {
    const p = params.get("phone");
    if (p && initialRef) {
      setPhone(p);
      void find(initialRef, p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function find(r = ref, ph = phone) {
    setBusy(true);
    try {
      const o = await lookupOrder(r, ph);
      if (!o) { toast(t("notFound", lang), true); setOrder(null); }
      else { setOrder(o as Order); setHistory(null); }
    } catch { toast(t("notFound", lang), true); }
    setBusy(false);
  }

  // "See all my orders" — same phone-only trust level as guest checkout
  // already uses (no password), just widened from one order to every one.
  async function findAll(ph = phone) {
    if (!ph.trim()) { toast(t("required", lang), true); return; }
    setBusy(true);
    try {
      const list = await getOrdersByPhone(ph);
      setHistory(list as OrderSummary[]);
      setOrder(null);
      if (!list.length) toast(t("notFound", lang), true);
    } catch { toast(t("notFound", lang), true); }
    setBusy(false);
  }

  // ---------------- gate screen: no order and no history loaded yet ----------------
  if (!order && !history) {
    return (
      <div className="wrap">
        <h1>{t("trackTitle", lang)}</h1>
        <p className="sub">{t("trackHint", lang)}</p>
        <form className="panel" onSubmit={(e) => { e.preventDefault(); void find(); }}>
          <div className="field">
            <label htmlFor="tref">{t("ref", lang)}</label>
            <input id="tref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="ORD-2026-0001 / CD2026…" autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="tphone">{t("phone", lang)}</label>
            <input id="tphone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+670 7712 3456" />
          </div>
          <button className="btn" type="submit" disabled={busy}>{busy ? "…" : t("find", lang)}</button>
        </form>

        <div className="btn-row">
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => findAll()}>
            {t("seeAllOrders", lang)}
          </button>
        </div>

        <div className="note info">{t("noAccount", lang)}</div>
      </div>
    );
  }

  // ---------------- history list (phone-only, every order) ----------------
  if (history) {
    return (
      <div className="wrap">
        <h1>{t("myOrders", lang)}</h1>
        <p className="sub mono">{phone}</p>
        {history.length ? (
          <div className="list">
            {history.map((o) => (
              <Link key={o.ref} className="item" href={`/o/${o.ref}?phone=${encodeURIComponent(phone)}`} style={{ textDecoration: "none" }}>
                <div className="g">
                  <b>{o.ref}</b>
                  <span>{nowIso(o.created_at)} · {money(o.total)} · {o.mode === "pickup" ? t("pickup", lang) : t("delivery", lang)}</span>
                </div>
                <div className="acts">
                  <span className={"pill " + (o.pay_status === "paid" ? "ok" : o.pay_status === "unpaid" ? "" : "warn")}>
                    {t("ps_" + o.pay_status, lang)}
                  </span>
                  <span className={"pill " + (o.status === "completed" ? "ok" : o.status === "cancelled" ? "bad" : "warn")}>
                    {t("st_" + o.status, lang)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty"><p>{t("noResults", lang)}</p></div>
        )}
        <div className="btn-row">
          <button className="btn btn-ghost" type="button" onClick={() => setHistory(null)}>
            {t("backToSingle", lang)}
          </button>
        </div>
      </div>
    );
  }

  return <Dashboard order={order as Order} lang={lang} settings={settings} phone={phone}
    onRefresh={() => find((order as Order).ref, phone)}
    onSeeAll={() => findAll(phone)} />;
}

function Dashboard({
  order: o, lang, settings, phone, onRefresh, onSeeAll,
}: { order: Order; lang: Lang; settings?: Settings; phone: string; onRefresh: () => void; onSeeAll: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [addr, setAddr] = useState({
    address_line: o.address_line || "",
    municipality: o.municipality || "", post: o.post || "", suku: o.suku || "",
    aldeia: o.aldeia || "", landmark: o.landmark || "",
  });
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);

  // Admin free-text internal notes are stored with a leading "* " marker
  // (see addOrderNote) so they can be told apart from automatic status/
  // payment log lines. Surface them as extra timeline entries, shown
  // plainly like any other step (no asterisk, no italics) so they blend
  // in with the formal status steps rather than standing out as a
  // separate kind of thing.
  // The "current" (yellow) marker follows whichever happened most
  // recently: the status change itself, or a note added after it. So if
  // a note gets added after the order reached its current status, the
  // note becomes the highlighted "now" step and the status step behind
  // it settles back to a plain "done" circle -- and if the status is
  // then advanced again, the highlight returns to the status step.
  const noteLogs = (o.order_log || []).filter((l) => l.text.trim().startsWith("* "));
  const statusChangeTimes = (o.order_log || [])
    .filter((l) => l.text.trim().startsWith("Estadu:"))
    .map((l) => new Date(l.created_at).getTime());
  const lastStatusChangeAt = statusChangeTimes.length
    ? Math.max(...statusChangeTimes)
    : new Date(o.created_at).getTime();
  const lastNoteAt = noteLogs.length ? Math.max(...noteLogs.map((l) => new Date(l.created_at).getTime())) : null;
  const lastNoteId = noteLogs.length ? noteLogs[noteLogs.length - 1].id : null;
  const noteIsCurrent = lastNoteAt !== null && lastNoteAt > lastStatusChangeAt;

  const noteEntries = noteLogs.map((l) => (
    <li key={l.id} className={noteIsCurrent && l.id === lastNoteId ? "now done" : "done"}>
      <span className="pin" />
      <span className="t">{l.text.trim().slice(2)}</span>
    </li>
  ));

  const locked = ["out", "arrived", "completed", "cancelled"].includes(o.status);
  const cancellable = ["new", "confirmed"].includes(o.status) && !o.cancel_requested_at;
  // Pickup orders skip the delivery-only steps, so they get their own
  // shorter flow (and their own timeline positions) here.
  const flow = flowFor(o.mode);
  const at = flow.indexOf(o.status);
  const payPill = o.pay_status === "paid" ? "ok" : o.pay_status === "unpaid" ? "" : o.pay_status === "refunded" ? "bad" : "warn";

  async function saveAddr() {
    try {
      await updateOrderAddress(o.ref, phone, addr);
      toast(t("saved", lang));
      setEditing(false);
      onRefresh();
    } catch (e) { toast(String((e as Error).message), true); }
  }

  async function sendCancel() {
    try {
      await requestCancellation(o.ref, phone, reason || "—");
      toast(t("cancelSent", lang));
      setAsking(false);
      onRefresh();
    } catch (e) { toast(String((e as Error).message), true); }
  }

  async function onProof(file: File | undefined) {
    if (!file) return;
    try {
      const r = await compressImage(file, 900, 150);
      await uploadPaymentProof(o.ref, phone, r.data);
      toast(t("proofUploaded", lang));
      onRefresh();
    } catch (e) { toast(String((e as Error).message), true); }
  }

  return (
    <div className="wrap">
      <h1>{o.ref}</h1>
      <p className="sub">
        {o.buyer_name} · <span className="mono">{o.buyer_phone}</span> · {nowIso(o.created_at)}
      </p>

      {/* I1 status timeline */}
      <div className="panel">
        <h3>{t("status", lang)}</h3>
        {o.status === "cancelled" ? (
          <ul className="tl">
            <li className="cancelled done"><span className="pin" /><span className="t">{t("st_cancelled", lang)}</span></li>
            {noteEntries}
          </ul>
        ) : (
          <ul className="tl">
            {flow.slice(0, -1).map((s, i) => (
              <li key={s} className={i < at ? "done" : i === at ? (noteIsCurrent ? "done" : "now done") : ""}>
                <span className="pin" />
                <span className="t">
                  {t("st_" + s, lang)}
                  {i === at && s === "arrived" && settings && <small>{settings.wa_number}</small>}
                </span>
              </li>
            ))}
            {noteEntries}
            {flow.slice(-1).map((s) => {
              const i = flow.length - 1; // always the last step (the "completed" / pickup-ready step)
              return (
                <li key={s} className={i < at ? "done" : i === at ? (noteIsCurrent ? "done" : "now done") : ""}>
                  <span className="pin" />
                  <span className="t">{o.mode === "pickup" ? t("st_completed_pickup", lang) : t("st_" + s, lang)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* I7 cancellation — moved right under the timeline so self-service
          cancel is the first thing a buyer sees, not something buried
          below the contact-seller section. */}
      {cancellable && (
        asking ? (
          <div className="panel">
            <h3>{t("askCancel", lang)}</h3>
            <div className="field">
              <label>{t("cancelReason", lang)}</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="btn-row" style={{ margin: 0 }}>
              <button className="btn btn-danger" type="button" onClick={sendCancel}>{t("askCancel", lang)}</button>
              <button className="btn btn-ghost" type="button" onClick={() => setAsking(false)}>{t("cancel", lang)}</button>
            </div>
          </div>
        ) : (
          <div className="btn-row">
            <button className="btn btn-danger btn-sm" type="button" onClick={() => setAsking(true)}>
              {t("askCancel", lang)}
            </button>
          </div>
        )
      )}
      {o.cancel_requested_at && (
        <div className="note">{t("cancelSent", lang)} — “{o.cancel_reason}”</div>
      )}

      {/* I2 summary */}
      <div className="panel">
        <h3>{t("orderSummary", lang)}</h3>
        <div className="rows">
          {o.items.map((i, ix) => (
            <div className="kv" key={ix}>
              <span>{i.name}{i.size ? " · " + i.size : ""} × {i.qty}</span>
              <b>{money(i.price * i.qty)}</b>
            </div>
          ))}
          <div className="kv"><span>{t("subtotal", lang)}</span><b>{money(o.subtotal)}</b></div>
          <div className="kv">
            <span>{t("deliveryFee", lang)}</span>
            <b>{o.quote_requested ? t("quoteOnRequest", lang) : money(o.fee)}</b>
          </div>
          <div className="kv total"><span>{t("total", lang)}</span><b>{money(o.total)}</b></div>
        </div>
        <button className="btn btn-amber btn-sm" type="button" style={{ marginTop: 10 }}
          onClick={() => { void downloadOrderInvoice(o, settings); }}>
          {t("downloadPdf", lang)}
        </button>
      </div>

      {/* I3 payment panel */}
      <div className="panel">
        <h3>{t("paymentPanel", lang)}</h3>
        <div className="kv"><span>{t("payment", lang)}</span><b>{t("pm_" + o.pay_method, lang)}</b></div>
        <div className="kv">
          <span>{t("paymentStatus", lang)}</span>
          <span className={"pill " + payPill}>{t("ps_" + o.pay_status, lang)}</span>
        </div>
        {o.pay_method === "bank" && settings && (
          <div className="note info" style={{ marginTop: 8 }}>
            <b>{t("bankDetails", lang)}</b>
            {settings.banks.map((b, i) => (
              <div className="mono" style={{ marginTop: 4 }} key={i}>{b.label} · {b.account} · {b.holder}</div>
            ))}
          </div>
        )}
        {o.pay_method === "wallet" && settings && (
          <div className="note info" style={{ marginTop: 8 }}>
            <b>{t("walletDetails", lang)}</b>
            {settings.wallets.map((w, i) => (
              <div className="mono" style={{ marginTop: 4 }} key={i}>{w.label} · {w.number}</div>
            ))}
          </div>
        )}
        {["bank", "wallet"].includes(o.pay_method) && (
          <div style={{ marginTop: 10 }}>
            {o.proof_url && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={o.proof_url} alt={t("proofUploaded", lang)}
                style={{ maxHeight: 150, borderRadius: 6, border: "1px solid var(--line)" }} />
            )}
            <label className="btn btn-ghost btn-sm" style={{ marginTop: 8, display: "inline-flex" }}>
              {o.proof_url ? t("uploadProof", lang) + " ↻" : t("uploadProof", lang)}
              <input type="file" accept="image/*" hidden onChange={(e) => onProof(e.target.files?.[0])} />
            </label>
          </div>
        )}
      </div>

      {/* I4 delivery details */}
      <div className="panel">
        <h3>{t("deliveryDetails", lang)}</h3>
        {o.mode === "pickup" ? (
          <div className="kv">
            <span>{t("pickup", lang)}</span>
            <b>{settings ? `${settings.suku}, ${settings.municipality}` : "—"}</b>
          </div>
        ) : editing ? (
          <>
            {o.address_line !== null ? (
              <>
                <div className="field"><label>{t("address", lang)}</label>
                  <input value={addr.address_line} onChange={(e) => setAddr({ ...addr, address_line: e.target.value })} /></div>
                <div className="field"><label>{t("landmark", lang)}</label>
                  <input value={addr.landmark} onChange={(e) => setAddr({ ...addr, landmark: e.target.value })} /></div>
              </>
            ) : (
              <>
                <div className="two">
                  <div className="field"><label>{t("municipality", lang)}</label>
                    <input value={addr.municipality} onChange={(e) => setAddr({ ...addr, municipality: e.target.value })} /></div>
                  <div className="field"><label>{t("post", lang)}</label>
                    <input value={addr.post} onChange={(e) => setAddr({ ...addr, post: e.target.value })} /></div>
                </div>
                <div className="two">
                  <div className="field"><label>{t("suku", lang)}</label>
                    <input value={addr.suku} onChange={(e) => setAddr({ ...addr, suku: e.target.value })} /></div>
                  <div className="field"><label>{t("aldeia", lang)}</label>
                    <input value={addr.aldeia} onChange={(e) => setAddr({ ...addr, aldeia: e.target.value })} /></div>
                </div>
                <div className="field"><label>{t("landmark", lang)}</label>
                  <input value={addr.landmark} onChange={(e) => setAddr({ ...addr, landmark: e.target.value })} /></div>
              </>
            )}
            <button className="btn btn-sm" type="button" onClick={saveAddr}>{t("save", lang)}</button>
          </>
        ) : (
          <>
            <div className="rows">
              {o.address_line ? (
                <>
                  <div className="kv"><span>{t("address", lang)}</span><b>{o.address_line}</b></div>
                  <div className="kv"><span>{t("landmark", lang)}</span><b>{o.landmark}</b></div>
                </>
              ) : (
                <>
                  <div className="kv"><span>{t("municipality", lang)}</span><b>{o.municipality}</b></div>
                  <div className="kv"><span>{t("post", lang)}</span><b>{o.post}</b></div>
                  <div className="kv"><span>{t("suku", lang)}</span><b>{o.suku}</b></div>
                  {o.aldeia && <div className="kv"><span>{t("aldeia", lang)}</span><b>{o.aldeia}</b></div>}
                  <div className="kv"><span>{t("landmark", lang)}</span><b>{o.landmark}</b></div>
                </>
              )}
            </div>
            {locked ? (
              <p className="note" style={{ marginTop: 8 }}>{t("addressLocked", lang)}</p>
            ) : (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} type="button"
                onClick={() => setEditing(true)}>{t("editAddress", lang)}</button>
            )}
          </>
        )}
      </div>

      {/* I5 seller contact */}
      {settings && (
        <div className="panel">
          <h3>{t("contactSeller", lang)}</h3>
          <div className="btn-row" style={{ margin: 0 }}>
            <a className="btn btn-wa" target="_blank" rel="noopener"
              href={waLink(settings.wa_number.replace(/[^\d]/g, ""), waOrderMsg(o, (p) => p))}>
              WhatsApp
            </a>
            <a className="btn btn-ghost" href={`tel:${settings.wa_number.replace(/\s/g, "")}`}>
              {t("call", lang)}
            </a>
          </div>
        </div>
      )}

      {/* I6 — jump to full order history for this phone */}
      <div className="btn-row">
        <button className="btn btn-ghost" type="button" onClick={onSeeAll}>
          {t("seeAllOrders", lang)}
        </button>
      </div>
    </div>
  );
}
