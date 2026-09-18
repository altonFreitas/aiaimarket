"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { saveBanks, saveSettings, saveWallets, saveZones } from "@/lib/actions/settings";
import { t } from "@/lib/i18n";
import WriteOnly, { useCanWrite } from "./Access";
import { normalizeRestockPct } from "@/lib/restock";
import { DISPLAY_CURRENCIES, normalizeCurrencyCode, taxRateAsPercent } from "@/lib/money";
import { parseNum as num, normalizeNumText } from "@/lib/numberInput";
import type { Bank, Lang, Settings, Wallet, Zone } from "@/lib/types";
import { ZONE_IDS, normalizeZones, zoneLabelKey } from "@/lib/zones";

export default function SettingsAdmin({ lang, settings }: { lang: Lang; settings: Settings }) {
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const canWrite = useCanWrite();

  const [f, setF] = useState({
    store_name: settings.store_name || "",
    wa_number: settings.wa_number || "",
    hours: settings.hours || "",
    municipality: settings.municipality || "",
    post: settings.post || "",
    suku: settings.suku || "",
    landmark: settings.landmark || "",
    pickup: !!settings.pickup,
    /* THE NUMBER BOXES HOLD STRINGS, LIKE THE LEGAL ONES BELOW.
       They used to hold numbers, with onChange doing Number(e.target.value)
       -- and Number("") is 0, so deleting the last digit put a 0 straight
       back in the box. Backspace over the "0" in Tax and you got "0"
       again; type 1 after it and the box read "01". The only way to enter
       a number was to select the whole field first, which nobody does.

       A half-typed number is a string ("", "1.", "0.0") and none of those
       are numbers yet. Keeping the raw text means the box shows exactly
       what was typed, and the parsing happens once, on save. */
    commission_rate: String(settings.commission_rate ?? 10),
    seller_registration_enabled: settings.seller_registration_enabled ?? true,
    restock_alert_pct: String(normalizeRestockPct(settings.restock_alert_pct)),
    /* THE FIVE FACTS THE POLICY PAGES CANNOT KNOW. Empty strings rather
       than nulls because these are form inputs; saveSettings turns an empty
       period back into null, which is what keeps the policy page showing
       its unfinished notice rather than publishing "within 0 days". */
    legal_address: settings.legal_address || "",
    legal_registration: settings.legal_registration || "",
    legal_retention_years: settings.legal_retention_years ?? "",
    legal_return_days: settings.legal_return_days ?? "",
    legal_refund_days: settings.legal_refund_days ?? "",
    display_currency: normalizeCurrencyCode(settings.display_currency),
    // Shown as the percentage a person types; stored as the fraction the
    // arithmetic wants. See lib/money.ts.
    tax_rate: String(taxRateAsPercent(settings.tax_rate)),
    tax_label: settings.tax_label || "",
    tax_included: !!settings.tax_included,
  });
  const [banks, setBanks] = useState<Bank[]>(settings.banks || []);
  const [wallets, setWallets] = useState<Wallet[]>(settings.wallets || []);
  // Normalised up front, so the rows the owner edits ARE what gets saved
  // and the junk from the seed is gone the first time they touch this.
  const [zones, setZones] = useState<Zone[]>(() => normalizeZones(settings.zones));
  const [nb, setNb] = useState({ label: "", account: "", holder: "" });
  const [nw, setNw] = useState({ label: "", number: "" });
  /* What is currently being TYPED into a zone's fee box, by zone id. A
     zone with no entry here is not being edited and shows its saved fee. */
  const [feeDraft, setFeeDraft] = useState<Record<string, string>>({});
  const [editingBank, setEditingBank] = useState<number | null>(null);
  const [editingWallet, setEditingWallet] = useState<number | null>(null);

  const set = (k: string, v: string | boolean | number) => setF((s) => ({ ...s, [k]: v }));
  const refresh = () => startTransition(() => router.refresh());

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); toast(t("saved", lang)); refresh(); }
    catch (e) { toast(String((e as Error).message), true); }
    setBusy(false);
  }

  const field = (key: keyof typeof f, label: string, hint?: string) => (
    <div className="field">
      <label htmlFor={key}>{label}</label>
      <input id={key} value={f[key] as string} onChange={(e) => set(key, e.target.value)} />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );

  return (
    <>
      <h1>{t("settings", lang)}</h1>

      <div className="panel">
        <h3>{t("storeName", lang)}</h3>
        {field("store_name", t("storeName", lang))}
        {field("wa_number", t("waNumber", lang), "+670 …")}
        {field("hours", t("hours", lang))}
        <div className="two">
          {field("municipality", t("municipality", lang))}
          {field("post", t("post", lang))}
        </div>
        <div className="two">
          {field("suku", t("suku", lang))}
          {field("landmark", t("landmark", lang))}
        </div>
        <label className="check" data-on={f.pickup}>
          <input type="checkbox" checked={f.pickup} onChange={(e) => set("pickup", e.target.checked)} />
          <span>{t("pickup", lang)}</span>
        </label>
        <div className="field">
          <label htmlFor="commission_rate">{t("commissionRate", lang)}</label>
          <input id="commission_rate" type="number" min={0} max={100} step={0.5}
            value={f.commission_rate} onChange={(e) => set("commission_rate", e.target.value)}
            onBlur={(e) => set("commission_rate", normalizeNumText(e.target.value, 10))} />
          <p className="hint">{t("commissionRateHint", lang)}</p>
        </div>
        {/* The "accept new sellers" switch was here. Registering a store
            is by invitation now (supabase/seller-invites.sql), which is
            neither of the two states this offered: open to the whole
            internet, or shut to everybody. The field is still carried in
            this form's state so saving Settings does not rewrite the
            column, and nothing reads it. Invitations are minted on the
            Sellers screen. */
        }

        <div className="field" style={{ maxWidth: 220, marginTop: 10 }}>
          <label htmlFor="restock-pct">{t("restockAlertPct", lang)}</label>
          <input id="restock-pct" type="number" min={1} max={99} step={1}
            value={f.restock_alert_pct} disabled={busy || !canWrite}
            onChange={(e) => set("restock_alert_pct", e.target.value)}
            onBlur={(e) => set("restock_alert_pct", normalizeNumText(e.target.value, 0))} />
          <p className="hint">{t("restockAlertPctHint", lang)}</p>
        </div>
        {/* ---- the shop's own legal facts ---- */}
        <h3 style={{ marginTop: 22 }}>{t("legalFacts", lang)}</h3>
        <p className="hint" style={{ marginTop: -6 }}>{t("legalFactsHint", lang)}</p>
        <div className="two">
          <div className="field">
            <label htmlFor="lgl-addr">{t("legalAddress", lang)}</label>
            <input id="lgl-addr" value={f.legal_address} disabled={busy || !canWrite}
              onChange={(e) => set("legal_address", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="lgl-reg">{t("legalRegistration", lang)}</label>
            <input id="lgl-reg" value={f.legal_registration} disabled={busy || !canWrite}
              onChange={(e) => set("legal_registration", e.target.value)} />
          </div>
        </div>
        <div className="two">
          <div className="field">
            <label htmlFor="lgl-ret">{t("legalRetentionYears", lang)}</label>
            <input id="lgl-ret" type="number" min={1} max={99} value={f.legal_retention_years}
              disabled={busy || !canWrite}
              onChange={(e) => set("legal_retention_years", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="lgl-rtn">{t("legalReturnDays", lang)}</label>
            <input id="lgl-rtn" type="number" min={1} max={365} value={f.legal_return_days}
              disabled={busy || !canWrite}
              onChange={(e) => set("legal_return_days", e.target.value)} />
          </div>
        </div>
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="lgl-rfd">{t("legalRefundDays", lang)}</label>
          <input id="lgl-rfd" type="number" min={1} max={365} value={f.legal_refund_days}
            disabled={busy || !canWrite}
            onChange={(e) => set("legal_refund_days", e.target.value)} />
        </div>

        {/* ---- money ---- */}
        <h3 style={{ marginTop: 22 }}>{t("moneySettings", lang)}</h3>
        <div className="two">
          <div className="field">
            <label htmlFor="cur">{t("displayCurrency", lang)}</label>
            <select id="cur" value={f.display_currency} disabled={busy || !canWrite}
              onChange={(e) => set("display_currency", e.target.value)}>
              {Object.keys(DISPLAY_CURRENCIES).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <p className="hint">{t("displayCurrencyHint", lang)}</p>
          </div>
          <div className="field">
            <label htmlFor="taxr">{t("taxRate", lang)}</label>
            <input id="taxr" type="number" min={0} max={100} step={0.01}
              value={f.tax_rate} disabled={busy || !canWrite}
              onChange={(e) => set("tax_rate", e.target.value)}
              /* SETTLED INTO THE FORM IT WILL BE SAVED IN.
                 A number input steps using the BROWSER's locale, so in
                 Portuguese the spinner turns 0 into "0,01" -- which the
                 hint under this box calls 0.01 and which Number() reads as
                 NaN. parseNum accepts either separator so nothing is lost
                 either way; this makes the box agree with the hint the
                 moment it is left. */
              onBlur={(e) => set("tax_rate", normalizeNumText(e.target.value, 0))} />
            <p className="hint">{t("taxRateHint", lang)}</p>
          </div>
        </div>
        <div className="two">
          <div className="field">
            <label htmlFor="taxl">{t("taxLabel", lang)}</label>
            <input id="taxl" value={f.tax_label} disabled={busy || !canWrite}
              placeholder={t("taxDefaultLabel", lang)}
              onChange={(e) => set("tax_label", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="taxi">{t("taxIncluded", lang)}</label>
            <select id="taxi" value={f.tax_included ? "1" : "0"} disabled={busy || !canWrite}
              onChange={(e) => set("tax_included", e.target.value === "1")}>
              <option value="0">{t("taxAddedOn", lang)}</option>
              <option value="1">{t("taxInPrices", lang)}</option>
            </select>
            <p className="hint">{t("taxIncludedHint", lang)}</p>
          </div>
        </div>

        <WriteOnly>
          <button className="btn btn-amber btn-sm" style={{ marginTop: 10 }} disabled={busy}
            onClick={() => run(() => saveSettings({
              ...f,
              /* The boxes hold strings; the action wants numbers or null.

                 num() is for the three that must end up as A number: an
                 empty Tax box means "no tax", not NaN, and the server
                 normalises the value again afterwards (normalizeTaxRate,
                 normalizeRestockPct) so a silly figure typed here cannot
                 reach the database whatever this does. */
              commission_rate: num(f.commission_rate, 10),
              restock_alert_pct: num(f.restock_alert_pct, 0),
              tax_rate: num(f.tax_rate, 0),
              legal_retention_years: f.legal_retention_years === ""
                ? null : Number(f.legal_retention_years),
              legal_return_days: f.legal_return_days === ""
                ? null : Number(f.legal_return_days),
              legal_refund_days: f.legal_refund_days === ""
                ? null : Number(f.legal_refund_days),
            }))}>
            {t("save", lang)}
          </button>
        </WriteOnly>
      </div>

      <div className="panel">
        <h3>{t("banks", lang)}</h3>
        <div className="rows">
          {banks.map((b, i) => (
            <div className="kv" key={i}>
              <span>{b.label} · <span className="mono">{b.account}</span></span>
              <span style={{ display: "flex", gap: 4 }}>
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={busy}
                  aria-label={t("edit", lang)}
                  title={t("edit", lang)}
                  style={{ padding: "0 8px" }}
                  onClick={() => { setNb(b); setEditingBank(i); }}
                >
                  <EditIcon />
                </button>
                <button className="btn btn-sm btn-ghost" disabled={busy}
                  onClick={() => {
                    const next = banks.filter((_, ix) => ix !== i);
                    setBanks(next);
                    if (editingBank === i) { setEditingBank(null); setNb({ label: "", account: "", holder: "" }); }
                    run(() => saveBanks(next));
                  }}>
                  {t("del", lang)}
                </button>
              </span>
            </div>
          ))}
        </div>
        {editingBank !== null && (
          <p className="hint" style={{ margin: "8px 0 0" }}>{t("editingEntry", lang)}: {banks[editingBank]?.label}</p>
        )}
        <div className="two" style={{ marginTop: 8 }}>
          <input placeholder="BNCTL" value={nb.label} onChange={(e) => setNb({ ...nb, label: e.target.value })} />
          <input placeholder="0012 3456 7890" value={nb.account} onChange={(e) => setNb({ ...nb, account: e.target.value })} />
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <input placeholder={t("name", lang)} value={nb.holder} style={{ flex: 1 }}
            onChange={(e) => setNb({ ...nb, holder: e.target.value })} />
          <button className="btn btn-sm" disabled={busy || !nb.label || !nb.account}
            onClick={() => {
              const entry = { ...nb, holder: nb.holder || f.store_name };
              const next = editingBank !== null
                ? banks.map((b, ix) => (ix === editingBank ? entry : b))
                : [...banks, entry];
              setBanks(next); setNb({ label: "", account: "", holder: "" }); setEditingBank(null);
              run(() => saveBanks(next));
            }}>
            {editingBank !== null ? t("save", lang) : t("add", lang)}
          </button>
          {editingBank !== null && (
            <button className="btn btn-sm btn-ghost" type="button"
              onClick={() => { setEditingBank(null); setNb({ label: "", account: "", holder: "" }); }}>
              {t("cancel", lang)}
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        <h3>{t("wallets", lang)}</h3>
        <div className="rows">
          {wallets.map((w, i) => (
            <div className="kv" key={i}>
              <span>{w.label} · <span className="mono">{w.number}</span></span>
              <span style={{ display: "flex", gap: 4 }}>
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={busy}
                  aria-label={t("edit", lang)}
                  title={t("edit", lang)}
                  style={{ padding: "0 8px" }}
                  onClick={() => { setNw(w); setEditingWallet(i); }}
                >
                  <EditIcon />
                </button>
                <button className="btn btn-sm btn-ghost" disabled={busy}
                  onClick={() => {
                    const next = wallets.filter((_, ix) => ix !== i);
                    setWallets(next);
                    if (editingWallet === i) { setEditingWallet(null); setNw({ label: "", number: "" }); }
                    run(() => saveWallets(next));
                  }}>
                  {t("del", lang)}
                </button>
              </span>
            </div>
          ))}
        </div>
        {editingWallet !== null && (
          <p className="hint" style={{ margin: "8px 0 0" }}>{t("editingEntry", lang)}: {wallets[editingWallet]?.label}</p>
        )}
        <div className="two" style={{ marginTop: 8 }}>
          <input placeholder="Telemor Mosan" value={nw.label} onChange={(e) => setNw({ ...nw, label: e.target.value })} />
          <input placeholder="+670 7712 3456" value={nw.number} onChange={(e) => setNw({ ...nw, number: e.target.value })} />
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button className="btn btn-sm" disabled={busy || !nw.label || !nw.number}
            onClick={() => {
              const next = editingWallet !== null
                ? wallets.map((w, ix) => (ix === editingWallet ? nw : w))
                : [...wallets, nw];
              setWallets(next); setNw({ label: "", number: "" }); setEditingWallet(null);
              run(() => saveWallets(next));
            }}>
            {editingWallet !== null ? t("save", lang) : t("add", lang)}
          </button>
          {editingWallet !== null && (
            <button className="btn btn-sm btn-ghost" type="button"
              onClick={() => { setEditingWallet(null); setNw({ label: "", number: "" }); }}>
              {t("cancel", lang)}
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        <h3>{t("zones", lang)}</h3>
        <p className="hint" style={{ margin: "0 0 10px" }}>
          {t("zone_dili_center", lang)} / {t("zone_dili_outskirts", lang)} / {t("zone_other_municipality", lang)}
        </p>
        <div className="rows">
          {ZONE_IDS.map((zid) => {
            const z = zones.find((x) => x.id === zid) || { id: zid, fee: 0, quote: false };
            const update = (patch: Partial<Zone>) => {
              const next = zones.some((x) => x.id === zid)
                ? zones.map((x) => (x.id === zid ? { ...x, ...patch } : x))
                : [...zones, { ...z, ...patch }];
              setZones(next);
              run(() => saveZones(next));
            };
            return (
              <div className="kv" key={zid} style={{ alignItems: "center" }}>
                <span>{t(zoneLabelKey(zid), lang)}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {!z.quote && (
                    /* SAME DELETION BUG, PLUS A SAVE ON EVERY KEYSTROKE.
                       `Number(e.target.value) || 0` put a 0 back the moment
                       the box was emptied -- and because update() calls
                       saveZones(), every digit typed was a round trip to
                       the server. Typing "12.5" was four saves, three of
                       them of a number nobody meant (1, 12, 12.).

                       The draft holds what is being typed; the save happens
                       when the box is left, or on Enter. */
                    <input
                      type="number" step="0.5" min="0"
                      value={feeDraft[zid] ?? String(z.fee)}
                      style={{ width: 70, padding: "4px 6px" }}
                      disabled={busy}
                      onChange={(e) =>
                        setFeeDraft((d) => ({ ...d, [zid]: e.target.value }))}
                      onBlur={() => {
                        const draft = feeDraft[zid];
                        if (draft === undefined) return;
                        setFeeDraft((d) => {
                          const { [zid]: _drop, ...rest } = d; return rest;
                        });
                        // An emptied box means free delivery, not NaN.
                        const fee = num(draft, 0);
                        if (fee !== z.fee) update({ fee });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  )}
                  <label className="check" style={{ padding: "4px 8px" }} data-on={z.quote}>
                    <input type="checkbox" checked={z.quote} disabled={busy}
                      onChange={(e) => update({ quote: e.target.checked })} />
                    <span style={{ fontSize: 12 }}>{t("quoteOnRequest", lang)}</span>
                  </label>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
