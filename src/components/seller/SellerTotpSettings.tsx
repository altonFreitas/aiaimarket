"use client";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { startSellerTotpSetup, confirmSellerTotpSetupAction, disableSellerTotpAction } from "@/lib/actions/seller-totp";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

type View =
  | { name: "status" }
  | { name: "setup"; qrDataUrl: string; secretBase32: string };

/** Opt-in 2FA for a seller's own login — same underlying mechanism the
 * admin uses (lib/totp.ts, shared rather than duplicated), just started
 * and stopped from here instead of being forced on. Once enabled, every
 * future login goes through the extra code step on /account (see
 * SellerTotpVerifyForm), and every seller-scoped action/page enforces it
 * too (see requireSeller() / getCurrentSellerOrRedirect()). */
export default function SellerTotpSettings({ lang, initiallyEnabled }: { lang: Lang; initiallyEnabled: boolean }) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [view, setView] = useState<View>({ name: "status" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function startSetup() {
    setBusy(true);
    try {
      const setup = await startSellerTotpSetup();
      if (!setup) {
        // Already enabled by another tab/session in the moment between
        // clicking and this response landing.
        setEnabled(true);
        toast(t("totpAlreadyEnabled", lang));
      } else {
        setView({ name: "setup", ...setup });
      }
    } catch (e) {
      toast(String((e as Error).message), true);
    }
    setBusy(false);
  }

  async function confirmSetup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const ok = await confirmSellerTotpSetupAction(code);
      if (!ok) {
        toast(t("totpWrongCode", lang), true);
      } else {
        setEnabled(true);
        setView({ name: "status" });
        setCode("");
        toast(t("totpEnabledToast", lang));
        // A hard reload, not router.refresh() -- Safari/WebKit doesn't
        // always pick up a cookie set by this action's response in time
        // for a soft refresh to see it (confirmed directly during
        // testing on the login-time equivalent of this same step). The
        // short delay just lets the toast above actually be seen first.
        setTimeout(() => window.location.reload(), 600);
      }
    } catch (e) {
      toast(String((e as Error).message), true);
    }
    setBusy(false);
  }

  async function disable() {
    setBusy(true);
    try {
      await disableSellerTotpAction();
      setEnabled(false);
      toast(t("totpDisabledToast", lang));
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      toast(String((e as Error).message), true);
    }
    setBusy(false);
  }

  return (
    <div className="panel">
      <h3>{t("twoFactorAuth", lang)}</h3>
      <p className="hint" style={{ marginTop: -4 }}>{t("twoFactorAuthHint", lang)}</p>

      {view.name === "status" && (
        <>
          <p className="sub">
            {enabled ? t("totpStatusOn", lang) : t("totpStatusOff", lang)}
          </p>
          {enabled ? (
            <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={disable}>
              {busy ? "…" : t("totpDisable", lang)}
            </button>
          ) : (
            <button className="btn btn-amber btn-sm" type="button" disabled={busy} onClick={startSetup}>
              {busy ? "…" : t("totpEnable", lang)}
            </button>
          )}
        </>
      )}

      {view.name === "setup" && (
        <>
          <div style={{ textAlign: "center", marginTop: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={view.qrDataUrl} alt="TOTP QR code" width={180} height={180}
              style={{ margin: "0 auto", display: "block", borderRadius: 8 }} />
            <p className="hint" style={{ marginTop: 10 }}>{t("totpManualKey", lang)}</p>
            <p className="mono" style={{ fontSize: 13, wordBreak: "break-all" }}>{view.secretBase32}</p>
          </div>
          <form onSubmit={confirmSetup} noValidate style={{ marginTop: 10 }}>
            <div className="field">
              <label htmlFor="sellerSetupCode">{t("totpCode", lang)}</label>
              <input id="sellerSetupCode" inputMode="numeric" autoComplete="one-time-code"
                maxLength={6} placeholder="123456" required
                value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))} />
            </div>
            <div className="btn-row" style={{ margin: 0 }}>
              <button className="btn btn-amber btn-sm" type="submit" disabled={busy || code.length !== 6}>
                {busy ? "…" : t("totpConfirmEnable", lang)}
              </button>
              <button className="btn btn-ghost btn-sm" type="button"
                onClick={() => { setView({ name: "status" }); setCode(""); }}>
                {t("back", lang)}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
