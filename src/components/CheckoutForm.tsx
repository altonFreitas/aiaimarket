"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useBasket } from "@/lib/useBasket";
import { useToast } from "@/components/Toast";
import CopyButton from "@/components/CopyButton";
import { placeOrder } from "@/lib/actions/orders";
import { COUNTRIES } from "@/lib/countries";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Lang, PayMethod, Settings } from "@/lib/types";

const ALL_PAY: PayMethod[] = ["cod", "cop", "bank", "wallet"];

export default function CheckoutForm({ lang, settings }: { lang: Lang; settings: Settings }) {
  const { lines, subtotal, clear } = useBasket();
  const { toast } = useToast();
  const router = useRouter();

  const [mode, setMode] = useState<"delivery" | "pickup">("delivery");
  const [zoneId, setZoneId] = useState<string>(settings.zones[0]?.id || "");
  const [pay, setPay] = useState<PayMethod>("cod");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Phone: country selector + local number, combined on submit — Central
  // Dili has street addressing, so it gets a simple address field instead
  // of the full Municipality → Post → Suku → Aldeia hierarchy.
  const [countryCode, setCountryCode] = useState(COUNTRIES[0].code);
  const [customCode, setCustomCode] = useState("");
  const [localPhone, setLocalPhone] = useState("");

  const [f, setF] = useState({
    name: "", address: "", municipality: "", post: "", suku: "", aldeia: "", landmark: "", note: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  const zone = useMemo(() => settings.zones.find((z) => z.id === zoneId), [zoneId, settings.zones]);
  const fee = mode === "delivery" && zone && !zone.quote ? Number(zone.fee) : 0;
  const total = subtotal + fee;
  const isDiliCenter = mode === "delivery" && zoneId === "dili_center";
  const needsFullAddress = mode === "delivery" && !isDiliCenter;

  // Cash on delivery only makes sense for delivery orders; cash on pickup
  // only makes sense for pickup orders. Whichever doesn't apply to the
  // chosen "how do you want it" option is hidden below.
  const availablePay = useMemo(
    () => ALL_PAY.filter((m) => (mode === "pickup" ? m !== "cod" : m !== "cop")),
    [mode]
  );

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

    const localDigits = localPhone.replace(/[^\d]/g, "");
    const effectiveCode = countryCode === "other" ? customCode : countryCode;
    if (countryCode === "other" && !customCode) errs.phone = t("required", lang);
    else if (!localDigits) errs.phone = t("required", lang);
    else if (localDigits.length < 6 || localDigits.length > 12) errs.phone = t("badPhone", lang);

    if (isDiliCenter) {
      if (!f.address.trim()) errs.address = t("required", lang);
      if (!f.landmark.trim()) errs.landmark = t("required", lang);
    } else if (needsFullAddress) {
      (["municipality", "post", "suku", "landmark"] as const).forEach((k) => {
        if (!f[k].trim()) errs[k] = t("required", lang);
      });
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast(t("required", lang), true);
      return;
    }

    const fullPhone = "+" + effectiveCode + localDigits;

    setBusy(true);
    try {
      const ref = await placeOrder({
        name: f.name,
        phone: fullPhone,
        items: lines.map((l) => ({
          product_id: l.id, name: l.name, size: l.size, price: l.price, qty: l.qty,
        })),
        mode,
        zoneId: mode === "delivery" ? zoneId : undefined,
        addressLine: isDiliCenter ? f.address : undefined,
        municipality: needsFullAddress ? f.municipality : undefined,
        post: needsFullAddress ? f.post : undefined,
        suku: needsFullAddress ? f.suku : undefined,
        aldeia: needsFullAddress ? f.aldeia : undefined,
        landmark: mode === "delivery" ? f.landmark : undefined,
        payMethod: pay,
        note: f.note,
      });
      clear();
      toast(t("orderPlaced", lang));
      router.push(`/o/${ref}?phone=${encodeURIComponent(fullPhone)}`);
    } catch (err) {
      console.error(err);
      toast(String((err as Error).message || "Error"), true);
      setBusy(false);
    }
  }

  const field = (key: keyof typeof f, label: string, type = "text", hint?: string, placeholder?: string) => (
    <div className={"field" + (errors[key] ? " err" : "")}>
      <label htmlFor={key}>{label} *</label>
      <input
        id={key} type={type} value={f[key]} placeholder={placeholder}
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

          {/* Country + local number — the select shows the calling code,
              the buyer only has to type their own local digits. "Other"
              reveals a free-text code field for a country not listed. */}
          <div className={"field" + (errors.phone ? " err" : "")}>
            <label htmlFor="localPhone">{t("phone", lang)} *</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <select
                id="phoneCountry"
                aria-label={t("country", lang)}
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                style={{ flex: "0 0 auto", width: 108 }}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} +{c.code}
                  </option>
                ))}
                <option value="other">🌐 {t("otherCountry", lang)}</option>
              </select>
              {countryCode === "other" && (
                <input
                  id="customCode"
                  type="tel"
                  inputMode="numeric"
                  placeholder="+___"
                  value={customCode}
                  style={{ width: 64, flex: "0 0 auto" }}
                  onChange={(e) => setCustomCode(e.target.value.replace(/[^\d]/g, ""))}
                  aria-label={t("otherCountry", lang)}
                />
              )}
              <input
                id="localPhone"
                type="tel"
                value={localPhone}
                style={{ flex: 1, minWidth: 140 }}
                onChange={(e) => setLocalPhone(e.target.value)}
              />
            </div>
            <p className="hint">{t("phoneHint", lang)}</p>
            <p className="msg">{errors.phone}</p>
          </div>
        </div>

        <div className="panel">
          <h3>{t("howReceive", lang)}</h3>
          <div className="checks">
            <label className="check" data-on={mode === "delivery"}>
              <input type="radio" name="mode" checked={mode === "delivery"}
                onChange={() => { setMode("delivery"); setPay((p) => (p === "cop" ? "cod" : p)); }} />
              <span><b>{t("delivery", lang)}</b><small>{t("zone", lang)}</small></span>
            </label>
            {settings.pickup && (
              <label className="check" data-on={mode === "pickup"}>
                <input type="radio" name="mode" checked={mode === "pickup"}
                  onChange={() => { setMode("pickup"); setPay((p) => (p === "cod" ? "cop" : p)); }} />
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
                    {t("zone_" + z.id, lang)} — {z.quote ? t("quoteOnRequest", lang) : money(z.fee)}
                  </option>
                ))}
              </select>
            </div>

            {isDiliCenter ? (
              // Central Dili: street addressing works, so ask for a plain
              // address line instead of the full rural-style hierarchy.
              <>
                {field("address", t("streetAddress", lang), "text", t("addressHint", lang), t("addressPlaceholder", lang))}
                {field("landmark", t("landmark", lang), "text", undefined, t("landmarkExample", lang))}
              </>
            ) : (
              <>
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
                {field("landmark", t("landmark", lang), "text", t("landmarkHint", lang), t("landmarkExample", lang))}
              </>
            )}
          </div>
        )}

        <div className="panel">
          <h3>{t("payment", lang)}</h3>
          <p className="sub" style={{ margin: "0 0 8px" }}>{t("choosePay", lang)}</p>
          <div className="checks">
            {availablePay.map((m) => (
              <label className="check" key={m} data-on={pay === m}>
                <input type="radio" name="pay" checked={pay === m} onChange={() => setPay(m)} />
                <span>
                  <b>{t("pm_" + m, lang)}</b>
                  {m === "fiar" && <small>{t("pm_fiar_note", lang)}</small>}
                </span>
              </label>
            ))}
          </div>

          {pay === "bank" && (
            <div className="note info" style={{ marginTop: 8 }}>
              <b>{t("bankDetails", lang)}</b>
              {settings.banks.map((b, i) => (
                <div className="mono" style={{ marginTop: 4, display: "flex", alignItems: "center" }} key={i}>
                  {b.label} · {b.account} · {b.holder}
                  <CopyButton value={b.account} lang={lang} />
                </div>
              ))}
            </div>
          )}
          {pay === "wallet" && (
            <div className="note info" style={{ marginTop: 8 }}>
              <b>{t("walletDetails", lang)}</b>
              {settings.wallets.map((w, i) => (
                <div className="mono" style={{ marginTop: 4, display: "flex", alignItems: "center" }} key={i}>
                  {w.label} · {w.number}
                  <CopyButton value={w.number} lang={lang} />
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
