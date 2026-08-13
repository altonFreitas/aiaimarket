"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loginSeller } from "@/lib/actions/seller-auth";
import PasswordField from "@/components/PasswordField";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export default function SellerLoginForm({ lang }: { lang: Lang }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await loginSeller(email, password);
      router.push("/seller/dashboard");
      router.refresh();
    } catch (err) {
      setError((err as Error).message || "Error");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="panel">
        <h1>{t("sellerLoginTitle", lang)}</h1>
        <div className="field">
          <label htmlFor="email">{t("email", lang)}</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <PasswordField id="password" label={t("password", lang)} value={password}
          onChange={setPassword} autoComplete="current-password" required />
        {error && <p className="msg">{error}</p>}
        <div className="btn-row">
          <button className="btn btn-amber" type="submit" disabled={pending}>
            {pending ? "…" : t("logIn", lang)}
          </button>
        </div>
        <p className="sub" style={{ marginTop: 12 }}>
          {t("needSellerAccount", lang)} <Link href="/seller/register">{t("becomeSeller", lang)}</Link>
        </p>
      </div>
    </form>
  );
}
