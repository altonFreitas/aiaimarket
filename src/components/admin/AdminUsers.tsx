"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { createAdminUser, setAdminUserActive, resetAdminUserPassword } from "@/lib/actions/adminUsers";
import { MIN_PASSWORD_LEN } from "@/lib/passwordRules";
import { nowIso } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { AdminUserRow } from "@/lib/data/admin";
import type { Lang } from "@/lib/types";

/* Staff accounts.
 *
 * The owner's own login is not here and cannot be changed here: it lives in
 * the environment, which is what makes it the way back in if anything on
 * this screen goes wrong. */
export default function AdminUsers({ lang, users }: { lang: Lang; users: AdminUserRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const refresh = () => startTransition(() => router.refresh());
  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await fn(); toast(done); refresh(); }
    catch (e) { toast(e instanceof Error ? e.message : t("error", lang), true); }
    setBusy(false);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("adminUsers", lang)}</h1>
          <p className="sub">{t("adminUsersSub", lang)}</p>
        </div>
        <button type="button" className="btn btn-sm btn-ghost"
          onClick={() => setAdding(!adding)} disabled={busy}>
          {adding ? t("cancel", lang) : t("addAdminUser", lang)}
        </button>
      </div>

      <p className="note info">{t("ownerLoginNote", lang)}</p>

      {adding && (
        <div className="panel">
          <div className="two">
            <div className="field">
              <label htmlFor="au-name">{t("name", lang)}</label>
              <input id="au-name" value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="au-email">{t("email", lang)}</label>
              <input id="au-email" type="email" value={f.email}
                onChange={(e) => setF({ ...f, email: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="au-pass">{t("password", lang)}</label>
            <input id="au-pass" type="password" value={f.password}
              onChange={(e) => setF({ ...f, password: e.target.value })} />
            <p className="hint">
              {t("passwordMin", lang).replace("{n}", String(MIN_PASSWORD_LEN))}
              {" "}{t("totpOnFirstLogin", lang)}
            </p>
          </div>
          <div className="bar">
            <button type="button" className="btn btn-primary" disabled={busy}
              onClick={() => run(async () => {
                await createAdminUser(f);
                setF({ name: "", email: "", password: "" });
                setAdding(false);
              }, t("adminUserCreated", lang))}>
              {busy ? t("saving", lang) : t("addAdminUser", lang)}
            </button>
          </div>
        </div>
      )}

      <div className="panel">
        {!users.length ? (
          <p className="hint" style={{ margin: 0 }}>{t("noAdminUsers", lang)}</p>
        ) : (
          <div className="scroll-x">
            <table className="tbl tbl-compact">
              <thead>
                <tr>
                  <th>{t("name", lang)}</th><th>{t("email", lang)}</th>
                  <th>{t("twoFactor", lang)}</th><th>{t("lastLogin", lang)}</th>
                  <th>{t("status", lang)}</th><th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={u.active ? "" : "row-muted"}>
                    <td><b>{u.name}</b></td>
                    <td className="mono">{u.email}</td>
                    <td>
                      <span className={"pill " + (u.totp_enabled ? "ok" : "warn")}>
                        {t(u.totp_enabled ? "twoFactorOn" : "twoFactorPending", lang)}
                      </span>
                    </td>
                    <td>{u.last_login_at ? nowIso(u.last_login_at) : "—"}</td>
                    <td>
                      <span className={"pill " + (u.active ? "ok" : "muted")}>
                        {t(u.active ? "active" : "inactive", lang)}
                      </span>
                    </td>
                    <td className="num">
                      <div className="acts">
                        <button type="button" className="btn btn-sm btn-ghost" disabled={busy}
                          onClick={() => { setResetFor(resetFor === u.id ? null : u.id); setNewPassword(""); }}>
                          {t("resetPassword", lang)}
                        </button>
                        <button type="button"
                          className={"btn btn-sm " + (u.active ? "btn-danger" : "btn-ghost")}
                          disabled={busy}
                          onClick={() => run(() => setAdminUserActive(u.id, !u.active),
                            t(u.active ? "adminUserDisabled" : "adminUserEnabled", lang))}>
                          {t(u.active ? "disable" : "enable", lang)}
                        </button>
                      </div>
                      {resetFor === u.id && (
                        <div className="bar" style={{ marginTop: 8, justifyContent: "flex-end" }}>
                          <input type="password" value={newPassword} placeholder={t("newPassword", lang)}
                            onChange={(e) => setNewPassword(e.target.value)} style={{ maxWidth: 200 }} />
                          <button type="button" className="btn btn-sm btn-primary" disabled={busy}
                            onClick={() => run(async () => {
                              await resetAdminUserPassword(u.id, newPassword);
                              setResetFor(null); setNewPassword("");
                            }, t("passwordReset", lang))}>
                            {t("save", lang)}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
