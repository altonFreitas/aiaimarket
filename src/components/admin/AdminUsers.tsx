"use client";
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import {
  createAdminUser, setAdminUserActive, resetAdminUserPassword, setAdminUserAccess,
} from "@/lib/actions/adminUsers";
import { MIN_PASSWORD_LEN } from "@/lib/passwordRules";
import PasswordField from "@/components/PasswordField";
import { nowIso } from "@/lib/utils";
import { t } from "@/lib/i18n";
import AccessPicker, { accessSummary } from "./AccessPicker";
import type { AdminRole, SectionKey } from "@/lib/adminSections";
import type { AdminUserRow } from "@/lib/data/admin";
import type { Lang } from "@/lib/types";

/** Columns in the table below: name, email, access, two-factor, last
 * sign-in, status, actions. The detail row spans all of them. */
const ACCESS_COLUMNS = 7;

/* Staff accounts.
 *
 * The owner's own login is not here and cannot be changed here: it lives in
 * the environment, which is what makes it the way back in if anything on
 * this screen goes wrong. */
export default function AdminUsers({ lang, users, ownerEmail }: {
  lang: Lang; users: AdminUserRow[];
  /** The owner's own sign-in address, so a row that collides with it can
   * be pointed out. Empty if the shop has none configured. */
  ownerEmail?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  // A new account starts as a reader with nothing ticked, matching the
  // column defaults. Deciding what somebody may do is the point of this
  // screen; starting it at "everything" would make the decision skippable.
  const BLANK = {
    name: "", email: "", password: "",
    role: "reader" as AdminRole, sections: [] as SectionKey[],
  };
  const [f, setF] = useState(BLANK);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [accessFor, setAccessFor] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ role: AdminRole; sections: SectionKey[] }>(
    { role: "reader", sections: [] });

  function openAccess(u: AdminUserRow) {
    if (accessFor === u.id) { setAccessFor(null); return; }
    setAccessFor(u.id);
    setDraft({ role: u.role, sections: [...u.sections] });
  }

  // An account made under the owner's own address before that was
  // refused. It can no longer sign anybody in -- the login resolves that
  // address to the owner and stops -- so it is dead weight that looks
  // like a working account. Better to say so than to leave it sitting
  // there being misread.
  const shadow = ownerEmail
    ? users.filter((u) => u.email.trim().toLowerCase() === ownerEmail)
    : [];

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

      {/* Where staff actually sign in. The person icon on the shop is the
          CUSTOMER account and will never accept one of these -- which is
          exactly the wrong door somebody walks into first. */}
      <p className="note info">
        {t("staffSignInHere", lang).split("{url}")[0]}
        <a href="/admin/login" className="mono">/admin/login</a>
        {t("staffSignInHere", lang).split("{url}")[1]}
      </p>
      <p className="note info">{t("ownerLoginNote", lang)}</p>

      {shadow.length > 0 && (
        <p className="note warn">
          {t("ownerEmailClash", lang).replace("{email}", ownerEmail || "")}
        </p>
      )}

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
          <PasswordField
            id="au-pass" label={t("password", lang)} value={f.password}
            onChange={(v) => setF({ ...f, password: v })}
            hint={<>
              {t("passwordMin", lang).replace("{n}", String(MIN_PASSWORD_LEN))}
              {" "}{t("totpOnFirstLogin", lang)}
            </>}
          />
          <AccessPicker lang={lang} role={f.role} sections={f.sections}
            onRole={(role) => setF({ ...f, role })}
            onSections={(sections) => setF({ ...f, sections })} disabled={busy} />

          <div className="bar">
            <button type="button" className="btn btn-primary" disabled={busy}
              onClick={() => run(async () => {
                await createAdminUser(f);
                setF(BLANK);
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
                  <th>{t("accessCol", lang)}</th>
                  <th>{t("twoFactor", lang)}</th><th>{t("lastLogin", lang)}</th>
                  <th>{t("status", lang)}</th><th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <Fragment key={u.id}>
                  <tr className={u.active ? "" : "row-muted"}>
                    <td><b>{u.name}</b></td>
                    <td className="mono">{u.email}</td>
                    <td className="access-cell">
                      {u.email.trim().toLowerCase() === ownerEmail
                        ? <span className="pill bad">{t("cannotSignIn", lang)}</span>
                        : accessSummary(lang, u.role, u.sections)}
                    </td>
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
                          onClick={() => openAccess(u)}>
                          {t("changeAccess", lang)}
                        </button>
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
                        <div className="bar reset-bar">
                          <div className="reset-input">
                            <PasswordField value={newPassword} onChange={setNewPassword}
                              placeholder={t("newPassword", lang)} />
                          </div>
                          <button type="button" className="btn btn-sm btn-primary" disabled={busy}
                            onClick={() => run(async () => {
                              await resetAdminUserPassword(u.id, newPassword);
                              setResetFor(null); setNewPassword("");
                            }, t("passwordReset", lang))}>
                            {t("save", lang)}
                          </button>
                          {/* A way out that is not "reload the page". Opening
                              a password box by mistake should cost one click
                              to close, not a lost train of thought. */}
                          <button type="button" className="btn btn-sm btn-ghost" disabled={busy}
                            onClick={() => { setResetFor(null); setNewPassword(""); }}>
                            {t("cancel", lang)}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {accessFor === u.id && (
                    /* A full-width row underneath, not a panel inside the
                       actions cell. Inside the cell the checklist squeezed
                       every other column -- a three-word name wrapped to
                       three lines -- because a table column is as wide as
                       its widest cell. Same pattern the stock and sales
                       tables already use to open a detail. */
                    <tr className="detail-row">
                      <td colSpan={ACCESS_COLUMNS}>
                        <div className="access-edit">
                          <AccessPicker lang={lang} role={draft.role} sections={draft.sections}
                            onRole={(role) => setDraft({ ...draft, role })}
                            onSections={(sections) => setDraft({ ...draft, sections })}
                            disabled={busy} />
                          <div className="bar">
                            <button type="button" className="btn btn-sm btn-primary" disabled={busy}
                              onClick={() => run(async () => {
                                await setAdminUserAccess(u.id, draft.role, draft.sections);
                                setAccessFor(null);
                              }, t("accessSaved", lang))}>
                              {t("save", lang)}
                            </button>
                            <button type="button" className="btn btn-sm btn-ghost" disabled={busy}
                              onClick={() => setAccessFor(null)}>
                              {t("cancel", lang)}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
