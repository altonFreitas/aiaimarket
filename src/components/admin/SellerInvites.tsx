"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { createSellerInvite, revokeSellerInvite } from "@/lib/actions/seller-invites";
import { inviteState } from "@/lib/sellerInvites";
import { t } from "@/lib/i18n";
import WriteOnly from "./Access";
import type { SellerInviteRow } from "@/lib/data/admin";
import type { Lang } from "@/lib/types";

/* Making somebody a seller: press the button, send the link.
 *
 * THE LINK IS SHOWN ONCE, right after it is minted, and never again. The
 * list below carries no token at all (see adminSellerInvites) -- it is a
 * client component, so anything it received would be sitting in the page
 * source of the Sellers screen. A screenshot of this screen must not be
 * every open invitation.
 *
 * The note is the only thing that makes the list usable. Eight live links
 * are eight identical rows without it, and withdrawing the right one
 * becomes guesswork.
 */
/** What a link that no longer works says about itself. `ok` is not in
 * here: a live one names its expiry date instead. */
const STATE_LABEL: Record<string, string> = {
  used: "inviteStateUsed",
  revoked: "inviteStateRevoked",
  expired: "inviteStateExpired",
  missing: "inviteMissing",
};

export default function SellerInvites({
  lang, invites,
}: { lang: Lang; invites: SellerInviteRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ url: string; expiresAt: string } | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const invite = await createSellerInvite(note);
      setMade({ url: invite.url, expiresAt: invite.expiresAt });
      setNote("");
      router.refresh();
    } catch (e) { toast(String((e as Error).message), true); }
    setBusy(false);
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast(t("inviteCopied", lang));
    } catch {
      // Clipboard access is refused in plenty of ordinary situations (an
      // insecure origin, a browser that asks first). The link is on screen
      // and selectable either way, so this is a nudge, not a failure.
      toast(t("inviteCopied", lang), true);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await revokeSellerInvite(id);
      router.refresh();
    } catch (e) { toast(String((e as Error).message), true); }
    setBusy(false);
  }

  const open = invites.filter((i) => inviteState(i) === "ok");
  const rest = invites.filter((i) => inviteState(i) !== "ok").slice(0, 10);

  return (
    <div className="panel">
      <h3>{t("sellerInvites", lang)}</h3>
      <p className="hint" style={{ marginTop: -4 }}>{t("sellerInvitesHint", lang)}</p>

      <WriteOnly>
        <form onSubmit={create} className="invite-new" noValidate>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label htmlFor="inviteNote">{t("inviteFor", lang)}</label>
            <input id="inviteNote" value={note} maxLength={200}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Alton — AITA Store, WhatsApp" />
          </div>
          <button className="btn btn-amber btn-sm" type="submit" disabled={busy}>
            {busy ? "…" : t("newInvite", lang)}
          </button>
        </form>
        <p className="hint">{t("inviteForHint", lang)}</p>
      </WriteOnly>

      {made && (
        // The one moment the token is on screen. Selectable text as well as
        // a copy button, because clipboard permission is refused often
        // enough that a copy-only design leaves the owner with nothing.
        <div className="invite-made">
          <p className="crumb">{t("inviteExpiresOn", lang)} {made.expiresAt.slice(0, 10)}</p>
          <code className="invite-url">{made.url}</code>
          <button className="btn btn-sm" type="button" onClick={() => copy(made.url)}>
            {t("inviteCopy", lang)}
          </button>
        </div>
      )}

      {invites.length === 0 ? (
        <p className="hint">{t("inviteNone", lang)}</p>
      ) : (
        <ul className="invite-list">
          {[...open, ...rest].map((i) => {
            const state = inviteState(i);
            return (
              <li key={i.id} className={"invite-row" + (state === "ok" ? " is-open" : "")}>
                <div>
                  <b>{i.note || "—"}</b>
                  <span className="hint">
                    {/* A live link says when it stops working; a spent one
                        says what became of it and when. "Used by" with
                        nothing after it, which this said first, reads as a
                        missing name rather than as a finished invitation. */}
                    {state === "ok"
                      ? `${t("inviteExpiresOn", lang)} ${i.expires_at.slice(0, 10)}`
                      : `${t(STATE_LABEL[state], lang)} ${(i.used_at || i.revoked_at || i.expires_at).slice(0, 10)}`}
                    {" · "}{i.created_by}
                  </span>
                </div>
                {state === "ok" && (
                  <WriteOnly>
                    <button className="btn btn-ghost btn-sm" type="button" disabled={busy}
                      onClick={() => revoke(i.id)}>
                      {t("inviteRevoke", lang)}
                    </button>
                  </WriteOnly>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
