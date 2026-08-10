"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { checkPasswordAction, finishTotpSetupAction, finishTotpLoginAction } from "@/lib/actions/auth";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

type Step =
  | { name: "credentials" }
  | { name: "setup"; qrDataUrl: string; secretBase32: string }
  | { name: "verify" };

export default function LoginForm({ lang }: { lang: Lang }) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>({ name: "credentials" });
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const [pending, setPending] = useState(false);

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setPending(true);
    try {
      const res = await checkPasswordAction(identifier, password);
      if (!res.ok) { setError(t("wrongLogin", lang)); setPending(false); return; }
      if (!res.totpEnabled) {
        setStep({ name: "setup", qrDataUrl: res.qrDataUrl, secretBase32: res.secretBase32 });
      } else {
        setStep({ name: "verify" });
      }
    } catch {
      setError(t("wrongLogin", lang));
    }
    setPending(false);
  }

  async function submitSetup(e: React.FormEvent) {
    e.preventDefault();
    if (step.name !== "setup") return;
    setError(""); setPending(true);
    try {
      const res = await finishTotpSetupAction(identifier, password, code);
      if (!res.ok) { setError(t("totpWrongCode", lang)); setPending(false); return; }
      router.push("/admin");
    } catch {
      setError(t("totpWrongCode", lang));
      setPending(false);
    }
  }

  async function submitVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setPending(true);
    try {
      const res = await finishTotpLoginAction(identifier, password, code);
      if (!res.ok) {
        setLocked(!!res.locked);
        setError(res.locked ? t("totpLocked", lang) : t("totpWrongCode", lang));
        setPending(false);
        return;
      }
      router.push("/admin");
    } catch {
      setError(t("totpWrongCode", lang));
      setPending(false);
    }
  }

  function backToStart() {
    setStep({ name: "credentials" });
    setCode(""); setError(""); setLocked(false);
  }

  // ---------------- Step 1: email + password ----------------
  if (step.name === "credentials") {
    return (
      <div className="wrap" style={{ maxWidth: 420 }}>
        <h1>{t("ownerLogin", lang)}</h1>
        <form className="panel" onSubmit={submitCredentials}>
          <div className="field">
            <label htmlFor="identifier">{t("emailOrPhone", lang)}</label>
            <input id="identifier" autoComplete="username" required
              value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">{t("password", lang)}</label>
            <div style={{ position: "relative" }}>
              <input
                id="password" type={showPassword ? "text" : "password"}
                autoComplete="current-password" required
                value={password} onChange={(e) => setPassword(e.target.value)}
                style={{ paddingRight: 40 }}
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}
                style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
                  width: 32, height: 32, border: 0, background: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--muted)", borderRadius: 6 }}>
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
          </div>
          {error && <p className="note" style={{ marginBottom: 10 }}>{error}</p>}
          <button className="btn" style={{ width: "100%" }} type="submit" disabled={pending}>
            {pending ? "…" : t("login", lang)}
          </button>
        </form>
      </div>
    );
  }

  // ---------------- Step 2a: first-time TOTP setup ----------------
  if (step.name === "setup") {
    return (
      <div className="wrap" style={{ maxWidth: 420 }}>
        <h1>{t("totpSetupTitle", lang)}</h1>
        <p className="sub">{t("totpSetupHint", lang)}</p>
        <div className="panel" style={{ textAlign: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={step.qrDataUrl} alt="TOTP QR code" width={200} height={200}
            style={{ margin: "0 auto", display: "block", borderRadius: 8 }} />
          <p className="hint" style={{ marginTop: 10 }}>{t("totpManualKey", lang)}</p>
          <p className="mono" style={{ fontSize: 13, wordBreak: "break-all" }}>{step.secretBase32}</p>
        </div>
        <form className="panel" onSubmit={submitSetup}>
          <div className="field">
            <label htmlFor="setupCode">{t("totpCode", lang)}</label>
            <input id="setupCode" inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} placeholder="123456" required
              value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))} />
          </div>
          {error && <p className="note" style={{ marginBottom: 10 }}>{error}</p>}
          <div className="btn-row" style={{ margin: 0 }}>
            <button className="btn btn-amber" type="submit" disabled={pending || code.length !== 6}>
              {pending ? "…" : t("totpConfirmEnable", lang)}
            </button>
            <button className="btn btn-ghost" type="button" onClick={backToStart}>{t("back", lang)}</button>
          </div>
        </form>
      </div>
    );
  }

  // ---------------- Step 2b: ongoing login, code only ----------------
  return (
    <div className="wrap" style={{ maxWidth: 420 }}>
      <h1>{t("ownerLogin", lang)}</h1>
      <p className="sub">{t("totpEnterCode", lang)}</p>
      <form className="panel" onSubmit={submitVerify}>
        <div className="field">
          <label htmlFor="verifyCode">{t("totpCode", lang)}</label>
          <input id="verifyCode" inputMode="numeric" autoComplete="one-time-code"
            maxLength={6} placeholder="123456" required autoFocus disabled={locked}
            value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ""))} />
        </div>
        {error && <p className="note" style={{ marginBottom: 10 }}>{error}</p>}
        <div className="btn-row" style={{ margin: 0 }}>
          <button className="btn" type="submit" disabled={pending || locked || code.length !== 6}>
            {pending ? "…" : t("totpVerify", lang)}
          </button>
          <button className="btn btn-ghost" type="button" onClick={backToStart}>{t("back", lang)}</button>
        </div>
      </form>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a17.6 17.6 0 0 1-2.16 3.19m-3.3 2.87A9.12 9.12 0 0 1 12 20c-7 0-11-8-11-8a17.6 17.6 0 0 1 4.22-5.94" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  );
}
