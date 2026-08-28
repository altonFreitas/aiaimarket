"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { saveSupplier, deleteSupplier } from "@/lib/actions/procurement";
import { SOURCING_COUNTRIES, countryFlag, countryName } from "@/lib/countries";
import { money } from "@/lib/utils";
import { RateBar } from "./Charts";
import { t } from "@/lib/i18n";
import type { SupplierPerformance } from "@/lib/procurement";
import type { Lang, Supplier } from "@/lib/types";

const blank = () => ({
  id: "", name: "", countryCode: "", contactName: "", email: "", phone: "",
  leadTimeDays: "", notes: "", active: true,
});

export default function SuppliersAdmin({
  lang, performance,
}: { lang: Lang; performance: SupplierPerformance[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ReturnType<typeof blank> | null>(null);
  const set = (patch: Partial<ReturnType<typeof blank>>) =>
    setForm((s) => (s ? { ...s, ...patch } : s));

  function edit(s: Supplier) {
    setForm({
      id: s.id, name: s.name, countryCode: s.country_code, contactName: s.contact_name,
      email: s.email, phone: s.phone,
      leadTimeDays: s.lead_time_days == null ? "" : String(s.lead_time_days),
      notes: s.notes, active: s.active,
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      await saveSupplier({
        id: form.id || undefined,
        name: form.name,
        countryCode: form.countryCode,
        contactName: form.contactName,
        email: form.email,
        phone: form.phone,
        leadTimeDays: form.leadTimeDays === "" ? null : Number(form.leadTimeDays),
        notes: form.notes,
        active: form.active,
      });
      toast(t("saved", lang));
      setForm(null);
      router.refresh();
    } catch (err) { toast(String((err as Error).message), true); }
    setBusy(false);
  }

  async function remove(p: SupplierPerformance) {
    if (!window.confirm(t("deleteSupplierAsk", lang))) return;
    setBusy(true);
    try {
      const res = await deleteSupplier(p.supplier.id);
      // Deactivated rather than deleted is a different outcome and is said so
      // plainly -- otherwise the row staying put looks like a failed delete.
      toast(res.deactivated
        ? t("supplierDeactivated", lang).replace("{n}", String(res.orders))
        : t("deleted", lang));
      router.refresh();
    } catch (err) { toast(String((err as Error).message), true); }
    setBusy(false);
  }

  return (
    <>
      <p className="crumb"><Link href="/admin/procurement">{t("procurement", lang)}</Link> / {t("suppliers", lang)}</p>
      <div className="panel-head">
        <h1>{t("suppliers", lang)}</h1>
        {!form && (
          <button className="btn btn-sm btn-amber" type="button" onClick={() => setForm(blank())}>
            + {t("newSupplier", lang)}
          </button>
        )}
      </div>

      {form && (
        <form className="panel" onSubmit={submit}>
          <h3>{form.id ? t("editSupplier", lang) : t("newSupplier", lang)}</h3>
          <div className="two">
            <div className="field">
              <label htmlFor="sn">{t("supplierName", lang)}</label>
              <input id="sn" value={form.name} onChange={(e) => set({ name: e.target.value })} required />
            </div>
            <div className="field">
              <label htmlFor="sc">{t("country", lang)}</label>
              <select id="sc" value={form.countryCode} onChange={(e) => set({ countryCode: e.target.value })}>
                <option value="">—</option>
                {SOURCING_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="two">
            <div className="field">
              <label htmlFor="cn">{t("contactName", lang)}</label>
              <input id="cn" value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="se">{t("email", lang)}</label>
              <input id="se" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
            </div>
          </div>
          <div className="two">
            <div className="field">
              <label htmlFor="sp">{t("phone", lang)}</label>
              <input id="sp" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="lt">{t("leadTime", lang)}</label>
              <input id="lt" type="number" min="0" value={form.leadTimeDays}
                onChange={(e) => set({ leadTimeDays: e.target.value })} />
              <p className="hint">{t("leadTimeHint", lang)}</p>
            </div>
          </div>
          <div className="field">
            <label htmlFor="sno">{t("notes", lang)}</label>
            <textarea id="sno" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </div>
          <label className="toggle">
            <input type="checkbox" checked={form.active}
              onChange={(e) => set({ active: e.target.checked })} /> {t("activeSupplier", lang)}
          </label>
          <div className="btn-row">
            <button className="btn btn-amber" type="submit" disabled={busy}>{busy ? "…" : t("save", lang)}</button>
            <button className="btn btn-ghost" type="button" onClick={() => setForm(null)}>{t("cancel", lang)}</button>
          </div>
        </form>
      )}

      <div className="scroll-x">
        <table className="tbl">
          <thead><tr>
            <th>{t("supplier", lang)}</th>
            <th className="num">{t("score", lang)}</th>
            <th className="num">{t("purchaseOrders", lang)}</th>
            <th className="num">{t("value", lang)}</th>
            <th className="num">{t("quantity", lang)}</th>
            <th className="num">{t("avgUnitPrice", lang)}</th>
            <th className="num">{t("avgDeliveryTime", lang)}</th>
            <th className="num">{t("onTimeRate", lang)}</th>
            <th className="num">{t("lastPurchase", lang)}</th>
            <th className="num">{t("nextArrival", lang)}</th>
            <th></th>
          </tr></thead>
          <tbody>
            {performance.map((p) => (
              <tr key={p.supplier.id} className={p.supplier.active ? "" : "row-muted"}>
                <td>
                  <b>{countryFlag(p.supplier.country_code)} {p.supplier.name}</b>
                  <span className="stock-sub">
                    {countryName(p.supplier.country_code)}
                    {p.supplier.contact_name ? ` · ${p.supplier.contact_name}` : ""}
                    {!p.supplier.active ? ` · ${t("inactive", lang)}` : ""}
                  </span>
                </td>
                <td className="num">
                  {p.onTimeRate == null ? <span className="hint">{t("unrated", lang)}</span>
                    : <b className={p.score >= 70 ? "score-ok" : p.score >= 45 ? "score-mid" : "score-bad"}>{p.score}</b>}
                </td>
                <td className="num">{p.orders}{p.pendingOrders ? <span className="stock-sub">{p.pendingOrders} {t("pendingOrders", lang).toLowerCase()}</span> : null}</td>
                <td className="num">{money(p.value)}<span className="stock-sub">{(p.share * 100).toFixed(1)}%</span></td>
                <td className="num">{p.qty.toLocaleString()}</td>
                <td className="num">{p.avgUnitPrice == null ? "—" : money(p.avgUnitPrice)}</td>
                <td className="num">{p.avgDeliveryDays == null ? "—" : Math.round(p.avgDeliveryDays) + "d"}</td>
                <td className="num"><RateBar rate={p.onTimeRate} /></td>
                <td className="num">{p.lastPurchase || "—"}</td>
                <td className="num">{p.nextArrival || "—"}</td>
                <td className="num">
                  <div className="acts">
                    <button className="btn btn-sm btn-ghost" type="button" disabled={busy}
                      onClick={() => edit(p.supplier)}>{t("edit", lang)}</button>
                    <button className="btn btn-sm btn-danger" type="button" disabled={busy}
                      onClick={() => remove(p)}>{t("delete", lang)}</button>
                  </div>
                </td>
              </tr>
            ))}
            {!performance.length && (
              <tr><td colSpan={11}><p className="hint" style={{ margin: 0 }}>{t("noDataYet", lang)}</p></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
