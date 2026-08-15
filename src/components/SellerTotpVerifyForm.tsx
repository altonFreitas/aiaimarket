"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { verifySellerLoginTotp } from "@/lib/actions/seller-totp";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/** Shown on /account when a seller's password check already succeeded
 * (a real Supabase session exists) but they've enabled 2FA and haven't
 * cleared it yet this session — see app/account/page.tsx. On success,
 * just re-navigates to /account; the server component there re-checks
 * and sends them on to the dashboard once the second-factor cookie is
 * set, so this component doesn't need to know where "next" actually is. */
export default function SellerTotpVerifyForm({ lang }: { lang: Lang }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setPending(true);
    try {
      const res = await verifySellerLoginTotp(code);
      if (!res.ok) {
        setLocked(res.locked);
        setError(res.locked ? t("totpLocked", lang) : t("totpWrongCode", lang));
        setPending(false);
        return;
      }
      router.push("/account");
      router.refresh();
    } catch {
      setError(t("totpWrongCode", lang));
      setPending(false);
    }
  }

  return (
    <div className="panel">
      <h1>{t("myAccount", lang)}</h1>
      <p className="sub">{t("totpEnterCode", lang)}</p>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="sellerTotpCode">{t("totpCode", lang)}</label>
          <input id="sellerTotpCode" inputMode="numeric" autoComplete="one-time-code"
            maxLength={6} placeholder="123456" required autoFocus disabled={locked}
            value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))} />
        </div>
        {error && <p className="note" style={{ marginBottom: 10 }}>{error}</p>}
        <button className="btn btn-amber" type="submit" disabled={pending || locked || code.length !== 6}>
          {pending ? "…" : t("totpVerify", lang)}
        </button>
      </form>
    </div>
  );
}
