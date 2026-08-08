"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useBasket } from "@/lib/useBasket";
import { useToast } from "@/components/Toast";
import { placeOrder } from "@/lib/actions/orders";
import { money, phoneOk } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Lang, PayMethod, Settings } from "@/lib/types";

const ALL_PAY: PayMethod[] = ["cod", "cop", "bank", "wallet", "fiar"];

export default function CheckoutForm({ lang, settings }: { lang: Lang; settings: Settings }) {
  const { lines, subtotal, clear } = useBasket();
  const { toast } = useToast();
  const router = useRouter();

  const [mode, setMode] = useState<"delivery" | "pickup">("delivery");
  const [zoneId, setZoneId] = useState(settings.zones[0]?.id || "");
  const [pay, setPay] = useState<PayMethod>("cod");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: "", phone: "", municipality: "", post: "", suku: "", aldeia: "", landmark: "", note: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  const zone = useMemo(() => settings.zones.find((z) => z.id === zoneId), [zoneId, settings.zones]);
  const fee = mode === "delivery" && zone && !zone.quote ? Number(zone.fee) : 0;
  const total = subtotal + fee;

  if (!lines.length) {
    return (
      <div className="wrap">
        <h1>{t("checkout", lang)}</h1>
        <div className="empty">
          <p>{t("emptyList", lang)}</p>
          <a className="btn" href="/">{t("browse", lang)}</a>
        </div>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.name.trim()) errs.name = t("required", lang);
    if (!f.phone.trim()) errs.phone = t("required", lang);
    else if (!phoneOk(f.phone)) errs.phone = t("badPhone", lang);
    if (mode === "delivery") {
      (["municipality", "post", "suku", "landmark"] as const).forEach((k) => {
        if (!f[k].trim()) errs[k] = t("required", lang);
      });
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast(t("required", lang), true);
      return;
    }

    setBusy(true);
    try {
      const ref = await placeOrder({
        name: f.name,
        phone: f.phone,
        items: lines.map((l) => ({
          product_id: l.id, name: l.name, size: l.size, price: l.price, qty: l.qty,
        })),
        mode,
        zoneId: mode === "delivery" ? zoneId : undefined,
        municipality: f.municipality, post: f.post, suku: f.suku,
        aldeia: f.aldeia, landmark: f.landmark,
        payMethod: pay,
        note: f.note,
      });
      clear();
      toast(t("orderPlaced", lang));
      router.push(`/o/${ref}?phone=${encodeURIComponent(f.phone)}`);
    } catch (err) {
      console.error(err);
      toast(String((err as Error).message || "Error"), true);
      setBusy(false);
    }
  }

  const field = (key: keyof typeof f, label: string, type = "text", hint?: string) => (
    <div className={"field" + (errors[key] ? " err" : "")}>
      <label htmlFor={key}>{label} *</label>
      <input
        id={key} type={type} value={f[key]}
        onChange={(e) => set(key, e.target.value)}
      />
      {hint && <p className="hint">{hint}</p>}
      <p className="msg">{errors[key]}</p>
    </div>
  );

  return (
    <div className="wrap">
      <h1>{t("checkout", lang)}</h1>
      <p className="sub">{t("noAccount", lang)}</p>

      <form onSubmit={submit} noValidate>
        <div className="panel">
          <h3>{t("yourDetails", lang)}</h3>
          {field("name", t("name", lang))}
          {field("phone", t("phone", lang), "tel")}
        </div>

        <div className="panel">
          <h3>{t("howReceive", lang)}</h3>
          <div className="checks">
            <label className="check" data-on={mode === "delivery"}>
              <input type="radio" name="mode" checked={mode === "delivery"} onChange={() => setMode("delivery")} />
              <span><b>{t("delivery", lang)}</b><small>{t("zone", lang)}</small></span>
            </label>
            {settings.pickup && (
              <label className="check" data-on={mode === "pickup"}>
                <input type="radio" name="mode" checked={mode === "pickup"} onChange={() => setMode("pickup")} />
                <span>
                  <b>{t("pickup", lang)}</b>
                  <small>{settings.suku}, {settings.municipality} · {settings.hours}</small>
                </span>
              </label>
            )}
          </div>
        </div>

        {mode === "delivery" && (
          <div className="panel">
            <h3>{t("address", lang)}</h3>
            <div className="field">
              <label htmlFor="zone">{t("zone", lang)}</label>
              <select id="zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                {settings.zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} — {z.quote ? t("quoteOnRequest", lang) : money(z.fee)}
                  </option>
                ))}
              </select>
            </div>
            <div className="two">
              {field("municipality", t("municipality", lang))}
              {field("post", t("post", lang))}
            </div>
            <div className="two">
              {field("suku", t("suku", lang))}
              <div className="field">
                <label htmlFor="aldeia">{t("aldeia", lang)}</label>
                <input id="aldeia" value={f.aldeia} onChange={(e) => set("aldeia", e.target.value)} />
              </div>
            </div>
            {field("landmark", t("landmark", lang), "text", t("landmarkHint", lang))}
          </div>
        )}

        <div className="panel">
          <h3>{t("payment", lang)}</h3>
          <p className="sub" style={{ margin: "0 0 8px" }}>{t("choosePay", lang)}</p>
          <div className="checks">
            {ALL_PAY.map((m) => (
              <label className="check" key={m} data-on={pay === m}>
                <input type="radio" name="pay" checked={pay === m} onChange={() => setPay(m)} />
                <span>
                  <b>{t("pm_" + m, lang)}</b>
                  {m === "fiar" && <small>{t("pm_fiar_note", lang)}</small>}
                </span>
              </label>
            ))}
          </div>

          {/* G2 — details revealed only after the buyer picks that method */}
          {pay === "bank" && (
            <div className="note info" style={{ marginTop: 8 }}>
              <b>{t("bankDetails", lang)}</b>
              {settings.banks.map((b, i) => (
                <div className="mono" style={{ marginTop: 4 }} key={i}>
                  {b.label} · {b.account} · {b.holder}
                </div>
              ))}
            </div>
          )}
          {pay === "wallet" && (
            <div className="note info" style={{ marginTop: 8 }}>
              <b>{t("walletDetails", lang)}</b>
              {settings.wallets.map((w, i) => (
                <div className="mono" style={{ marginTop: 4 }} key={i}>
                  {w.label} · {w.number}
                </div>
              ))}
            </div>
          )}
          {pay === "fiar" && (
            <div className="note" style={{ marginTop: 8 }}>{t("pm_fiar_note", lang)}</div>
          )}
        </div>

        <div className="panel">
          <h3>{t("noteOrder", lang)}</h3>
          <div className="field">
            <textarea value={f.note} onChange={(e) => set("note", e.target.value)} />
          </div>
        </div>

        <div className="panel">
          <div className="kv"><span>{t("subtotal", lang)}</span><b>{money(subtotal)}</b></div>
          <div className="kv">
            <span>{t("deliveryFee", lang)}</span>
            <b>{mode === "delivery" && zone?.quote ? t("quoteOnRequest", lang) : money(fee)}</b>
          </div>
          <div className="kv total"><span>{t("total", lang)}</span><b>{money(total)}</b></div>
        </div>

        <div className="btn-row">
          <button className="btn btn-amber" type="submit" disabled={busy}>
            {busy ? "…" : t("confirmOrder", lang)}
          </button>
          <a className="btn btn-ghost" href="/list">{t("cancel", lang)}</a>
        </div>
      </form>
    </div>
  );
}
