"use client";
import { useActionState } from "react";
import { loginAction } from "@/lib/actions/auth";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export default function LoginForm({ lang }: { lang: Lang }) {
  const [state, action, pending] = useActionState(loginAction, undefined);

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
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {state?.error && <p className="note" style={{ marginBottom: 10 }}>{t("wrongLogin", lang)}</p>}
        <button className="btn" style={{ width: "100%" }} type="submit" disabled={pending}>
          {pending ? "…" : t("login", lang)}
        </button>
      </form>
    </div>
  );
}
