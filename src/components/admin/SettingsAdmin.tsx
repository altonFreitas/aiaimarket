"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { saveBanks, saveSettings, saveWallets, saveZones } from "@/lib/actions/settings";
import { t } from "@/lib/i18n";
import type { Bank, Lang, Wallet, Zone } from "@/lib/types";

export default function SettingsAdmin({ lang, settings }: { lang: Lang; settings: any }) {
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const [f, setF] = useState({
    store_name: settings.store_name || "",
    wa_number: settings.wa_number || "",
    hours: settings.hours || "",
    municipality: settings.municipality || "",
    post: settings.post || "",
    suku: settings.suku || "",
    landmark: settings.landmark || "",
    pickup: !!settings.pickup,
  });
  const [banks, setBanks] = useState<Bank[]>(settings.banks || []);
  const [wallets, setWallets] = useState<Wallet[]>(settings.wallets || []);
  const [zones, setZones] = useState<Zone[]>(settings.zones || []);
  const [nb, setNb] = useState({ label: "", account: "", holder: "" });
  const [nw, setNw] = useState({ label: "", number: "" });

  const set = (k: string, v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
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
        <button className="btn btn-amber btn-sm" style={{ marginTop: 10 }} disabled={busy}
          onClick={() => run(() => saveSettings(f))}>
          {t("save", lang)}
        </button>
      </div>

      <div className="panel">
        <h3>{t("banks", lang)}</h3>
        <div className="rows">
          {banks.map((b, i) => (
            <div className="kv" key={i}>
              <span>{b.label} · <span className="mono">{b.account}</span></span>
              <button className="btn btn-sm btn-ghost" disabled={busy}
                onClick={() => { const next = banks.filter((_, ix) => ix !== i); setBanks(next); run(() => saveBanks(next)); }}>
                {t("del", lang)}
              </button>
            </div>
          ))}
        </div>
        <div className="two" style={{ marginTop: 8 }}>
          <input placeholder="BNCTL" value={nb.label} onChange={(e) => setNb({ ...nb, label: e.target.value })} />
          <input placeholder="0012 3456 7890" value={nb.account} onChange={(e) => setNb({ ...nb, account: e.target.value })} />
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <input placeholder={t("name", lang)} value={nb.holder} style={{ flex: 1 }}
            onChange={(e) => setNb({ ...nb, holder: e.target.value })} />
          <button className="btn btn-sm" disabled={busy || !nb.label || !nb.account}
            onClick={() => {
              const next = [...banks, { ...nb, holder: nb.holder || f.store_name }];
              setBanks(next); setNb({ label: "", account: "", holder: "" }); run(() => saveBanks(next));
            }}>
            {t("add", lang)}
          </button>
        </div>
      </div>

      <div className="panel">
        <h3>{t("wallets", lang)}</h3>
        <div className="rows">
          {wallets.map((w, i) => (
            <div className="kv" key={i}>
              <span>{w.label} · <span className="mono">{w.number}</span></span>
              <button className="btn btn-sm btn-ghost" disabled={busy}
                onClick={() => { const next = wallets.filter((_, ix) => ix !== i); setWallets(next); run(() => saveWallets(next)); }}>
                {t("del", lang)}
              </button>
            </div>
          ))}
        </div>
        <div className="two" style={{ marginTop: 8 }}>
          <input placeholder="Telemor Mosan" value={nw.label} onChange={(e) => setNw({ ...nw, label: e.target.value })} />
          <input placeholder="+670 7712 3456" value={nw.number} onChange={(e) => setNw({ ...nw, number: e.target.value })} />
        </div>
        <button className="btn btn-sm" style={{ marginTop: 6 }} disabled={busy || !nw.label || !nw.number}
          onClick={() => {
            const next = [...wallets, nw]; setWallets(next); setNw({ label: "", number: "" }); run(() => saveWallets(next));
          }}>
          {t("add", lang)}
        </button>
      </div>

      <div className="panel">
        <h3>{t("zones", lang)}</h3>
        <p className="hint" style={{ margin: "0 0 10px" }}>
          {t("zone_dili_center", lang)} / {t("zone_dili_outskirts", lang)} / {t("zone_other_municipality", lang)}
        </p>
        <div className="rows">
          {(["dili_center", "dili_outskirts", "other_municipality"] as const).map((zid) => {
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
                <span>{t("zone_" + zid, lang)}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {!z.quote && (
                    <input
                      type="number" step="0.5" min="0" value={z.fee}
                      style={{ width: 70, padding: "4px 6px" }}
                      disabled={busy}
                      onChange={(e) => update({ fee: Number(e.target.value) || 0 })}
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