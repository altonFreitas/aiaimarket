"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { updateSellerProfile } from "@/lib/actions/seller-settings";
import { t } from "@/lib/i18n";
import type { Lang, Seller } from "@/lib/types";

export default function SellerSettingsForm({ lang, seller }: { lang: Lang; seller: Seller }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    storeName: seller.store_name,
    description: seller.description,
    phone: seller.phone,
    address: seller.address,
    city: seller.city,
    country: seller.country,
  });
  const [deliveryAvailable, setDeliveryAvailable] = useState(seller.delivery_available);
  const [pickupAvailable, setPickupAvailable] = useState(seller.pickup_available);
  const [deliveryFee, setDeliveryFee] = useState(seller.delivery_fee != null ? String(seller.delivery_fee) : "");
  const [deliveryArea, setDeliveryArea] = useState(seller.delivery_area);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateSellerProfile({
        ...f,
        deliveryAvailable, pickupAvailable,
        deliveryFee: deliveryFee.trim() ? Number(deliveryFee) : null,
        deliveryArea,
      });
      toast(t("settingsSaved", lang));
      router.refresh();
    } catch (err) {
      toast(String((err as Error).message), true);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="panel">
        <h1>{t("sellerSettings", lang)}</h1>
        <div className="field">
          <label htmlFor="storeName">{t("storeName", lang)}</label>
          <input id="storeName" required value={f.storeName} onChange={set("storeName")} />
        </div>
        <div className="field">
          <label htmlFor="description">{t("description", lang)}</label>
          <textarea id="description" value={f.description} onChange={set("description")} />
        </div>
        <div className="field">
          <label htmlFor="phone">{t("phone", lang)}</label>
          <input id="phone" value={f.phone} onChange={set("phone")} />
        </div>
        <div className="field">
          <label htmlFor="address">{t("sellerAddress", lang)}</label>
          <input id="address" value={f.address} onChange={set("address")} />
        </div>
        <div className="two">
          <div className="field">
            <label htmlFor="city">{t("city", lang)}</label>
            <input id="city" value={f.city} onChange={set("city")} />
          </div>
          <div className="field">
            <label htmlFor="country">{t("country", lang)}</label>
            <input id="country" value={f.country} onChange={set("country")} />
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>{t("sellerShipping", lang)}</h3>
        <p className="hint" style={{ marginTop: -4 }}>{t("sellerShippingHint", lang)}</p>
        <label className="check" data-on={deliveryAvailable}>
          <input type="checkbox" checked={deliveryAvailable} onChange={(e) => setDeliveryAvailable(e.target.checked)} />
          <span>{t("delivery", lang)}</span>
        </label>
        <label className="check" data-on={pickupAvailable}>
          <input type="checkbox" checked={pickupAvailable} onChange={(e) => setPickupAvailable(e.target.checked)} />
          <span>{t("pickup", lang)}</span>
        </label>
        <div className="field">
          <label htmlFor="deliveryFee">{t("deliveryFee", lang)}</label>
          <input id="deliveryFee" type="number" min={0} step={0.5} value={deliveryFee}
            onChange={(e) => setDeliveryFee(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="deliveryArea">{t("deliveryArea", lang)}</label>
          <input id="deliveryArea" value={deliveryArea} onChange={(e) => setDeliveryArea(e.target.value)}
            placeholder="Dili, Caicoli…" />
        </div>
      </div>

      <div className="btn-row">
        <button className="btn btn-amber" type="submit" disabled={busy}>
          {busy ? "…" : t("saveSettings", lang)}
        </button>
      </div>
    </form>
  );
}
