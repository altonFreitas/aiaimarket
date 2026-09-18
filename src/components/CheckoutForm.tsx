"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useBasket } from "@/lib/useBasket";
import { useToast } from "@/components/Toast";
import CopyButton from "@/components/CopyButton";
import { placeOrder } from "@/lib/actions/orders";
import { COUNTRIES } from "@/lib/countries";
import { placeholder } from "@/lib/placeholder";
import { money } from "@/lib/utils";
import { taxOnLines } from "@/lib/tax";
import { taxRateAsPercent } from "@/lib/money";
import { useMoney, useQuote } from "@/components/Currency";
import { personName } from "@/lib/personName";
import { t } from "@/lib/i18n";
import { normalizeZones } from "@/lib/zones";
import type { Lang, PayMethod, Settings } from "@/lib/types";

const ALL_PAY: PayMethod[] = ["cod", "cop", "bank", "wallet", "card"];

/** crypto.randomUUID where it exists -- every browser this shop supports,
 * over HTTPS. The fallback is for an insecure origin during development,
 * where randomUUID is not exposed; it does not need to be unguessable,
 * only unique, because the key is scoped to one basket and the server
 * refuses a duplicate rather than trusting it. */
function newAttemptKey(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function CheckoutForm({
  lang, settings, cardAvailable = false,
}: { lang: Lang; settings: Settings; cardAvailable?: boolean }) {
  const { lines, ready, subtotal, setQty, remove, clear } = useBasket();
  const { toast } = useToast();
  const router = useRouter();

  const [mode, setMode] = useState<"delivery" | "pickup">("delivery");
  /* THE THREE REAL ZONES, whatever the database happens to hold.
   *
   * This used to read settings.zones straight through and label each entry
   * with t("zone_" + id) -- which returns the KEY for an id it does not
   * know. A shop that ran the seed offered "zone_z1", "zone_z2" and
   * "zone_z3" to shoppers as if they were places. See lib/zones.ts. */
  const zones = useMemo(() => normalizeZones(settings.zones), [settings.zones]);
  const [zoneId, setZoneId] = useState<string>(zones[0]?.id || "");
  const [pay, setPay] = useState<PayMethod>("cod");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  /* ONE KEY PER ATTEMPT, held across retries.
   *
   * setBusy(true) was the only thing standing between a flaky connection
   * and two identical orders -- and it does nothing at all when the request
   * went out, the reply never came back, and the buyer pressed the button
   * again. This key is minted once and reused for every retry of the same
   * basket, so the server can tell "again" from "another": the second
   * request is refused by a unique index and the first order's reference is
   * handed back (see supabase/order-idempotency.sql).
   *
   * A ref, not state: changing it must never re-render, and it must not be
   * reset by one. Cleared only after an order actually succeeds, because
   * the next order really is a different one. Minted on the first submit
   * rather than during render, which is a place a ref must not be read. */
  const attemptKey = useRef<string | null>(null);

  // Phone: country selector + local number, combined on submit — Central
  // Dili has street addressing, so it gets a simple address field instead
  // of the full Municipality → Post → Suku → Aldeia hierarchy.
  const [countryCode, setCountryCode] = useState(COUNTRIES[0].code);
  const [customCode, setCustomCode] = useState("");
  const [localPhone, setLocalPhone] = useState("");

  const [f, setF] = useState({
    firstName: "", lastName: "",
    address: "", municipality: "", post: "", suku: "", aldeia: "", landmark: "", note: "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const errorCount = Object.keys(errors).length;

  const zone = useMemo(() => zones.find((z) => z.id === zoneId), [zoneId, zones]);
  const fee = mode === "delivery" && zone && !zone.quote ? Number(zone.fee) : 0;

  /* TAX, SHOWN BEFORE IT IS CHARGED.
   *
   * It was already being charged. placeOrder() has computed tax on every
   * order since the tax columns existed -- but this summary added up only
   * goods and delivery, so a shop charging 10% quoted $13.00 here and wrote
   * $14.30 to the order. The shopper agreed to one number and was billed
   * another, which is the kind of surprise consumer law is least forgiving
   * about and the kind of thing a customer only finds on the invoice.
   *
   * The rate is per CATEGORY, because different goods are taxed
   * differently; taxRates maps a category id to its rate and an absent
   * entry means the shop's own rate. See lib/tax.ts. */
  const taxed = taxOnLines(
    lines.map((l) => l.price * l.qty),
    fee,
    Number(settings.tax_rate) || 0,
    !!settings.tax_included);

  const total = taxed.total;

  /* WHAT THE SHOPPER SAVED, when they saved anything.
   *
   * The line prices are ALREADY the discounted ones -- that is what is
   * being charged, and the subtotal has always been built from them -- so
   * this is the saving shown for its own sake, the way a receipt shows it.
   * Zero means there was no discount, and a "Discount $0.00" row is worse
   * than no row: it invites the reader to look for something that is not
   * there. */
  const discount = Math.round(lines.reduce(
    (a, l) => a + (l.listPrice ? (l.listPrice - l.price) * l.qty : 0), 0) * 100) / 100;
  /* What the row shows: added on, or the "of which" figure when prices
     already include it. Both are the same row because they answer the same
     question -- how much of this is tax -- and two rows that never appear
     together is two things to keep consistent. */
  const taxLine = settings.tax_included ? taxed.includedTax : taxed.tax;
  const taxName = (settings.tax_label || "").trim() || t("taxDefaultName", lang);
  const shopTaxPct = taxRateAsPercent(settings.tax_rate);
  /* Converted for display, from lib/fx.ts by way of the provider in the
     root layout. The figures below are dollars; m() multiplies. */
  const m = useMoney();
  const quote = useQuote();
  const isDiliCenter = mode === "delivery" && zoneId === "dili_center";
  const needsFullAddress = mode === "delivery" && !isDiliCenter;

  // Cash on delivery only makes sense for delivery orders; cash on pickup
  // only makes sense for pickup orders. Whichever doesn't apply to the
  // chosen "how do you want it" option is hidden below.
  const availablePay = useMemo(
    () => ALL_PAY.filter((m) => {
      // "card" only appears when a gateway is configured (see
      // lib/payments/registry.ts). Everything else is a manual method the
      // owner reconciles by hand and is always available.
      if (m === "card") return cardAvailable;
      return mode === "pickup" ? m !== "cod" : m !== "cop";
    }),
    [mode, cardAvailable]
  );

  // Same as the cart: not-yet-read is not the same as empty, and this
  // page told people their basket was empty on the way INTO paying for it.
  if (!ready) {
    return (
      <div className="wrap" aria-busy="true">
        <h1>{t("checkout", lang)}</h1>
      </div>
    );
  }

  if (!lines.length) {
    return (
      <div className="wrap">
        <h1>{t("checkout", lang)}</h1>
        <div className="empty">
          <p>{t("emptyList", lang)}</p>
          <Link className="btn" href="/">{t("browse", lang)}</Link>
        </div>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.firstName.trim()) errs.firstName = t("required", lang);
    if (!f.lastName.trim()) errs.lastName = t("required", lang);

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
      // Straight to the first one. A form this long scrolls past several
      // screens, and "something is required" with no idea which is how a
      // checkout gets abandoned.
      document.getElementById(Object.keys(errs)[0])?.focus();
      return;
    }

    const fullPhone = "+" + effectiveCode + localDigits;

    if (attemptKey.current == null) attemptKey.current = newAttemptKey();

    setBusy(true);
    try {
      const { ref, token } = await placeOrder({
        // Upper-cased and single-spaced here and again on the server, so
        // one shopper ordering three times is one customer on the sales
        // screens however they typed it. See lib/personName.ts.
        name: personName(f.firstName, f.lastName),
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
        idempotencyKey: attemptKey.current,
      });
      // Placed. The next order from this tab is a genuinely new one.
      attemptKey.current = null;
      clear();
      toast(t("orderPlaced", lang));

      /* STRAIGHT TO THE ORDER, WITH THE PROOF IN THE LINK.
       *
       * The phone number is still not in the URL -- the token is an HMAC
       * over it, not the number itself (lib/trackToken.ts), which is the
       * same link the store texts the buyer a moment later.
       *
       * It replaced a sessionStorage handoff that the order page read in an
       * effect AFTER mounting. That meant the buyer watched three screens
       * to see one order: checkout while the server worked, then the
       * "enter your phone" gate they had just proved they did not need,
       * then finally their order once a second round trip came back. Worse,
       * the handoff was read once and erased, so RELOADING the order page
       * threw them back to the gate permanently.
       *
       * With the token in the link the server verifies it before the page
       * is sent, so the order is in the first paint and a reload works.
       *
       * REPLACE, NOT PUSH. The basket was emptied two lines above, so the
       * checkout left behind in history is a form for goods that are no
       * longer in it -- and a browser restoring that form is an invitation
       * to order the same thing twice. Back should return to the shop. */
      router.replace(`/o/${ref}?t=${encodeURIComponent(token)}`);
    } catch (err) {
      console.error(err);
      toast(String((err as Error).message || "Error"), true);
      setBusy(false);
    }
  }

  /* THE MESSAGE IS TIED TO THE BOX, not just printed under it.
   *
   * aria-invalid says this control is the problem; aria-describedby makes
   * the sentence explaining it part of the field's announcement, so a
   * screen-reader user hears "Name, invalid entry, this field is required"
   * on arriving at the box rather than nothing at all. Without them the
   * red border and the red line under it are the entire feedback, which is
   * feedback only if you can see it.
   *
   * The describedby id is only attached when there IS a message: pointing
   * at an empty element makes some screen readers announce a blank. */
  const field = (key: keyof typeof f, label: string, type = "text", hint?: string, placeholder?: string) => (
    <div className={"field" + (errors[key] ? " err" : "")}>
      <label htmlFor={key}>{label} *</label>
      <input
        id={key} type={type} value={f[key]} placeholder={placeholder}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `${key}-err` : undefined}
        onChange={(e) => set(key, e.target.value)}
      />
      {hint && <p className="hint">{hint}</p>}
      <p className="msg" id={`${key}-err`}>{errors[key]}</p>
    </div>
  );

  return (
    <div className="wrap">
      <h1>{t("checkout", lang)}</h1>
      <p className="sub">{t("noAccount", lang)}</p>

      <div className="co-cols">
        {/* WHAT IS BEING BOUGHT, BESIDE THE FORM THAT BUYS IT.
            The page used to be nothing but fields: by the time someone
            reached "Confirm order" the last sight of their basket was two
            pages back, and the only number on screen was a total with
            nothing behind it. The lines are editable here because the
            moment a total is questioned is the moment it is read -- being
            sent back to the cart to drop one item, and starting the form
            again, is how an order stops being placed. */}
        <aside className="co-summary" aria-label={t("orderSummary", lang)}>
          <div className="panel">
            <h3>{t("orderSummary", lang)}</h3>
            <p className="hint" style={{ marginTop: -4 }}>{t("orderSummarySub", lang)}</p>

            <ul className="co-lines">
              {lines.map((l, i) => {
                const img = l.image || placeholder(l.name);
                return (
                  <li key={`${l.id}-${l.size}-${i}`} className="co-line">
                    {l.slug ? (
                      <Link href={`/p/${l.slug}`} className="co-line-ph">
                        <Image src={img} alt="" width={120} height={120} sizes="60px"
                          unoptimized={img.startsWith("data:")} />
                      </Link>
                    ) : (
                      <span className="co-line-ph">
                        <Image src={img} alt="" width={120} height={120} sizes="60px"
                          unoptimized={img.startsWith("data:")} />
                      </span>
                    )}

                    <div className="co-line-g">
                      <b>{l.name}</b>
                      <span>{l.size ? l.size + " · " : ""}{m(l.price)}</span>
                      <div className="qty" style={{ height: 30 }}>
                        <button type="button" onClick={() => setQty(i, l.qty - 1)}
                          aria-label={t("qty", lang)}>−</button>
                        <span>{l.qty}</span>
                        <button type="button" onClick={() => setQty(i, l.qty + 1)}
                          aria-label={t("qty", lang)}>+</button>
                      </div>
                    </div>

                    <div className="co-line-r">
                      <b className="mono">{m(l.price * l.qty)}</b>
                      <button type="button" className="co-line-x" onClick={() => remove(i)}
                        aria-label={`${t("del", lang)} ${l.name}`}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                        </svg>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* SUBTOTAL — DISCOUNT — DELIVERY — TAX — TOTAL, in that order,
                which is the order a receipt is read in: what the goods cost,
                what came off, what was added, and what is owed. */}
            <div className="kv"><span>{t("subtotal", lang)}</span><b>{m(subtotal)}</b></div>
            {discount > 0 && (
              <div className="kv">
                <span>{t("discount", lang)}</span>
                {/* Shown as a negative, because it comes OFF. A bare
                    "$5.00" on a line called Discount reads, for a moment,
                    like something being added. */}
                <b>−{m(discount)}</b>
              </div>
            )}
            <div className="kv">
              <span>{t("deliveryFee", lang)}</span>
              <b>{mode === "delivery" && zone?.quote
                ? t("quoteOnRequest", lang) : m(fee)}</b>
            </div>
            {/* NAMED BY THE SHOP -- VAT, IVA, GST, sales tax -- and carrying
                the rate, because "Tax $3.15" does not let anybody check the
                arithmetic and "Tax (10%)" does. */}
            {taxLine > 0 && (
              <div className="kv">
                <span>
                  {taxName}{shopTaxPct ? ` (${shopTaxPct}%)` : ""}
                  {settings.tax_included ? ` — ${t("taxIncludedShort", lang)}` : ""}
                </span>
                <b>{m(taxLine)}</b>
              </div>
            )}
            <div className="kv total"><span>{t("total", lang)}</span><b>{m(total)}</b></div>
            {/* WHAT WILL ACTUALLY BE COLLECTED.
                The shop banks dollars -- Timor-Leste uses them, and the
                money that changes hands at the door is dollars. Showing a
                euro total without saying so would misstate the transaction
                to somebody about to count out cash. Shown only when the
                two differ, because on a dollar shop it is noise. */}
            {quote.code !== "USD" && (
              <p className="hint" style={{ margin: "6px 0 0" }}>
                {t("chargedInUsd", lang)
                  .replace("{total}", money(total, "USD"))
                  .replace("{rate}", String(quote.rate))
                  .replace("{code}", quote.code)}
              </p>
            )}
          </div>
        </aside>

      <form onSubmit={submit} noValidate>
        {/* SAID ONCE, OUT LOUD, ON SUBMIT. The toast that used to be the
            only announcement is role="status" -- polite, transient, and it
            named no field. This is role="alert", so it interrupts, and it
            says how many boxes and where the first one is. Rendered only
            when there is something to say: an empty live region that is
            always present is a thing screen readers have to keep checking. */}
        {errorCount > 0 && (
          <div className="note bad" role="alert">
            <b>✕ {t("checkoutHasErrors", lang).replace("{n}", String(errorCount))}</b>
          </div>
        )}
        <div className="panel">
          <h3>{t("yourDetails", lang)}</h3>
          {/* Two boxes rather than one, and both are shown back in
              capitals as they are typed. A single "Name" field is where
              "Zita Felicia" and "Zita fElicia" come from, and the customer
              analysis then has one phone number wearing two names. */}
          <div className="two name-upper">
            {field("firstName", t("firstName", lang))}
            {field("lastName", t("lastName", lang))}
          </div>
          <p className="hint" style={{ marginTop: -4 }}>{t("nameUpperHint", lang)}</p>

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
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {t("zone_" + z.id, lang)} — {z.quote ? t("quoteOnRequest", lang) : m(z.fee)}
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
          {pay === "card" && (
            <div className="note info" style={{ marginTop: 8 }}>{t("pm_card_note", lang)}</div>
          )}
        </div>

        <div className="panel">
          <h3>{t("noteOrder", lang)}</h3>
          <div className="field">
            <textarea value={f.note} onChange={(e) => set("note", e.target.value)} />
          </div>
        </div>

        <div className="btn-row">
          <button className="btn btn-amber" type="submit" disabled={busy}>
            {busy ? "…" : t("confirmOrder", lang)}
          </button>
          {/* A Link, not a plain <a>. As an anchor this was a full page
              load: the browser threw the app away, asked the server for
              the cart, and painted the server's answer -- which cannot see
              localStorage -- before rehydrating. That is the second half
              of why Cancel flashed an empty basket, and the reason it felt
              like it was loading. */}
          <Link className="btn btn-ghost" href="/list">{t("cancel", lang)}</Link>
        </div>
      </form>
      </div>
    </div>
  );
}
