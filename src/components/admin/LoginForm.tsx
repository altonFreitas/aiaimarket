"use client";
import { useState, useActionState } from "react";
import { loginAction } from "@/lib/actions/auth";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export default function LoginForm({ lang }: { lang: Lang }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="wrap" style={{ maxWidth: 420 }}>
      <h1>{t("ownerLogin", lang)}</h1>
      <form className="panel" action={action}>
        <div className="field">
          <label htmlFor="identifier">{t("emailOrPhone", lang)}</label>
          <input id="identifier" name="identifier" autoComplete="username" required />
        </div>

        <div className="field">
          <label htmlFor="password">{t("password", lang)}</label>
          <div style={{ position: "relative" }}>
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              style={{ paddingRight: 40 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              style={{
                position: "absolute",
                right: 4,
                top: "50%",
                transform: "translateY(-50%)",
                width: 32,
                height: 32,
                border: 0,
                background: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
                borderRadius: 6,
              }}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </div>

        {state?.error && (
          <p className="note" style={{ marginBottom: 10 }}>{t("wrongLogin", lang)}</p>
        )}

        <button className="btn" style={{ width: "100%" }} type="submit" disabled={pending}>
          {pending ? "…" : t("login", lang)}
        </button>
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
