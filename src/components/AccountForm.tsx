"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { customerLogin, customerSignUp, isAdminEmail } from "@/lib/actions/customer-auth";
import PasswordField from "@/components/PasswordField";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/** One form, two modes — the same "person" entry point everyone uses.
 * Before touching Supabase Auth at all, it checks whether the typed
 * email is the store owner's — if so, it routes straight to the
 * existing, unchanged admin login (2FA and all) instead of trying (and
 * failing) to sign them in as a generic account. Otherwise this is a
 * normal customer login/signup; a seller's email works here too (see
 * /account/page.tsx, which resolves that server-side after login and
 * redirects to their dashboard). */
export default function AccountForm({ lang }: { lang: Lang }) {
  const router = useRouter();
  const { toast } = useToast();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (await isAdminEmail(email)) {
        router.push("/admin/login");
        return;
      }
      if (mode === "login") {
        await customerLogin(email, password);
      } else {
        await customerSignUp(email, password, phone);
      }
      router.push("/account");
      router.refresh();
    } catch (err) {
      toast(String((err as Error).message), true);
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h1>{t("myAccount", lang)}</h1>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button type="button" className={"btn btn-sm " + (mode === "login" ? "btn-amber" : "btn-ghost")}
          onClick={() => setMode("login")}>
          {t("logIn", lang)}
        </button>
        <button type="button" className={"btn btn-sm " + (mode === "signup" ? "btn-amber" : "btn-ghost")}
          onClick={() => setMode("signup")}>
          {t("createAccount", lang)}
        </button>
      </div>

      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="acc-email">{t("email", lang)}</label>
          <input id="acc-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <PasswordField id="acc-password" label={t("password", lang)} value={password} onChange={setPassword}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={mode === "signup" ? 8 : undefined} required />

        {mode === "signup" && (
          <div className="field">
            <label htmlFor="acc-phone">{t("phone", lang)}</label>
            <input id="acc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        )}

        <div className="btn-row">
          <button className="btn btn-amber" type="submit" disabled={busy}>
            {busy ? "…" : mode === "login" ? t("logIn", lang) : t("createAccount", lang)}
          </button>
        </div>
      </form>

      <p className="hint" style={{ marginTop: 10 }}>{t("accountOptionalHint", lang)}</p>
    </div>
  );
}
