"use client";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import {
  startAdminTotpSetupAction, confirmAdminTotpSetupAction, disableAdminTotpAction,
} from "@/lib/actions/admin-totp";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

type View =
  | { name: "status" }
  | { name: "setup"; qrDataUrl: string; secretBase32: string }
  | { name: "disable" };

/* The owner's own second factor, on and off.
 *
 * Deliberately the same screen shape as the seller's (SellerTotpSettings),
 * with one difference that is not cosmetic: turning it OFF asks for the
 * password. A seller reaching their settings has already passed both
 * factors this session and that is bar enough for their own account; the
 * owner's login is the one the whole shop is reachable through, and an
 * unattended open tab should not be able to disarm it.
 *
 * The password rather than a code, because the reason to turn it off is
 * usually that the phone holding the secret is gone -- see the action.
 *
 * MOVING IT TO A NEW PHONE is off, then on: the secret is wiped by the
 * first and a new one minted by the second. There is no "show me the QR
 * again" for an enrolled account, which is the property that makes the
 * secret worth anything.
 */
export default function AdminTotpSettings({
  lang, initiallyEnabled,
}: { lang: Lang; initiallyEnabled: boolean }) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [view, setView] = useState<View>({ name: "status" });
  const [code, setCode] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function startSetup() {
    setBusy(true);
    try {
      const setup = await startAdminTotpSetupAction();
      if (!setup) {
        // Enabled from another tab between the click and this response.
        setEnabled(true);
        toast(t("totpAlreadyEnabled", lang));
      } else {
        setView({ name: "setup", ...setup });
      }
    } catch (e) { toast(String((e as Error).message), true); }
    setBusy(false);
  }

  async function confirmSetup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (await confirmAdminTotpSetupAction(code)) {
        setEnabled(true);
        setView({ name: "status" });
        setCode("");
        toast(t("totpEnabledToast", lang));
      } else {
        toast(t("totpWrongCode", lang), true);
      }
    } catch (e) { toast(String((e as Error).message), true); }
    setBusy(false);
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await disableAdminTotpAction(identifier, password);
      if (res.ok) {
        setEnabled(false);
        setView({ name: "status" });
        setPassword("");
        toast(t("totpDisabledToast", lang));
      } else {
        toast(t("totpBadPassword", lang), true);
      }
    } catch (e) { toast(String((e as Error).message), true); }
    setBusy(false);
  }

  return (
    <div className="panel">
      <h3>{t("twoFactorAuth", lang)}</h3>

      {view.name === "status" && (
        <>
          {enabled ? (
            <button className="btn btn-ghost btn-sm" type="button"
              onClick={() => setView({ name: "disable" })}>
              {t("totpDisable", lang)}
            </button>
          ) : (
            <button className="btn btn-amber btn-sm" type="button" disabled={busy}
              onClick={startSetup}>
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
              <label htmlFor="adminSetupCode">{t("totpCode", lang)}</label>
              <input id="adminSetupCode" inputMode="numeric" autoComplete="one-time-code"
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

      {view.name === "disable" && (
        <form onSubmit={disable} noValidate style={{ marginTop: 10 }}>
          <p className="sub">{t("totpDisableAsk", lang)}</p>
          <p className="hint">{t("totpDisableWhy", lang)}</p>
          <div className="field">
            <label htmlFor="totpOffEmail">{t("totpEmail", lang)}</label>
            <input id="totpOffEmail" type="email" autoComplete="username" required
              value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="totpOffPassword">{t("password", lang)}</label>
            <input id="totpOffPassword" type="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="btn-row" style={{ margin: 0 }}>
            <button className="btn btn-sm" type="submit" disabled={busy || !password}>
              {busy ? "…" : t("totpDisable", lang)}
            </button>
            <button className="btn btn-ghost btn-sm" type="button"
              onClick={() => { setView({ name: "status" }); setPassword(""); }}>
              {t("back", lang)}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
