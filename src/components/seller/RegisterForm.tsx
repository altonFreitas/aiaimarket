"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerSeller } from "@/lib/actions/seller-auth";
import PasswordField from "@/components/PasswordField";
import { t } from "@/lib/i18n";
import type { Lang, SellerType } from "@/lib/types";

export default function RegisterForm({ lang }: { lang: Lang }) {
  const router = useRouter();
  const [f, setF] = useState({
    fullName: "", storeName: "", email: "", phone: "", password: "",
    description: "", address: "", city: "", country: "",
  });
  const [sellerType, setSellerType] = useState<SellerType>("individual");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await registerSeller({ ...f, sellerType });
      setDone(true);
    } catch (err) {
      setError((err as Error).message || "Error");
    }
    setPending(false);
  }

  if (done) {
    return (
      <div className="panel">
        <h1>{t("sellerRegisterTitle", lang)}</h1>
        <p className="sub">{t("sellerRegisterSuccess", lang)}</p>
        <button className="btn btn-amber" type="button"
          onClick={() => { router.push("/seller/dashboard"); router.refresh(); }}>
          {t("goToDashboard", lang)}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="panel">
        <h1>{t("sellerRegisterTitle", lang)}</h1>
        <p className="sub">{t("sellerRegisterSub", lang)}</p>

        <div className="field">
          <label htmlFor="fullName">{t("fullName", lang)}</label>
          <input id="fullName" required value={f.fullName} onChange={set("fullName")} />
        </div>
        <div className="field">
          <label htmlFor="storeName">{t("storeName", lang)}</label>
          <input id="storeName" required value={f.storeName} onChange={set("storeName")} />
        </div>
        <div className="two">
          <div className="field">
            <label htmlFor="email">{t("email", lang)}</label>
            <input id="email" type="email" required value={f.email} onChange={set("email")} />
          </div>
          <div className="field">
            <label htmlFor="phone">{t("phone", lang)}</label>
            <input id="phone" required value={f.phone} onChange={set("phone")} />
          </div>
        </div>
        <PasswordField id="password" label={t("password", lang)} value={f.password}
          onChange={(v) => setF((s) => ({ ...s, password: v }))}
          autoComplete="new-password" minLength={8} required />
        <div className="field">
          <label htmlFor="description">{t("description", lang)}</label>
          <textarea id="description" value={f.description} onChange={set("description")} />
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
        <div className="field">
          <label htmlFor="sellerType">{t("sellerTypeLabel", lang)}</label>
          <select id="sellerType" value={sellerType} onChange={(e) => setSellerType(e.target.value as SellerType)}>
            <option value="individual">{t("sellerTypeIndividual", lang)}</option>
            <option value="business">{t("sellerTypeBusiness", lang)}</option>
          </select>
        </div>

        {error && <p className="msg">{error}</p>}

        <div className="btn-row">
          <button className="btn btn-amber" type="submit" disabled={pending}>
            {pending ? "…" : t("createAccount", lang)}
          </button>
        </div>
        <p className="sub" style={{ marginTop: 12 }}>
          {t("alreadyHaveSellerAccount", lang)} <Link href="/seller/login">{t("logIn", lang)}</Link>
        </p>
      </div>
    </form>
  );
}
