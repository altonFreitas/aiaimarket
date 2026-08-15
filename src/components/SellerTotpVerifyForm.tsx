"use client";
import { useState } from "react";
import { verifySellerLoginTotp } from "@/lib/actions/seller-totp";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/** Shown on /account when a seller's password check already succeeded
 * (a real Supabase session exists) but they've enabled 2FA and haven't
 * cleared it yet this session — see app/account/page.tsx. On success,
 * forces a full page reload (not router.push/refresh) to land back on
 * /account. This matters more than it looks: Safari/WebKit doesn't
 * always pick up a cookie set by a server action's response in time
 * for a client-side-routed request right after — reproduced directly
 * during testing, where the totp cookie was confirmed set but the page
 * kept re-showing this same form. A hard navigation forces a genuine
 * new request cycle, which always has the cookie. */
export default function SellerTotpVerifyForm({ lang }: { lang: Lang }) {
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
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional: router.push()/refresh() here was the actual bug (see the comment on this component), a hard navigation is the fix, not an oversight.
      window.location.href = "/account";
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
