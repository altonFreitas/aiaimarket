"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  NO_CONSENT, OPTIONAL_CATEGORIES, readConsent, saveConsent,
  type Consent, type OptionalCategory,
} from "@/lib/cookieConsent";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* WHAT THIS SHOP PUTS ON YOUR DEVICE, AND WHAT YOU SAY ABOUT IT.
 *
 * This was a one-button notice, on the argument that a Reject with nothing
 * behind it is theatre: the shop sets no analytics and no advertising
 * cookies, only the language you picked and a staff sign-in session.
 *
 * That argument was right about the button and wrong about the mechanism.
 * A shop does not start tracking people by deciding to; it starts because
 * somebody pastes a snippet into a layout months later, on a site where
 * nothing was ever built to stop them. So the categories are real, they
 * default to OFF, and lib/cookieConsent.ts is the gate such a snippet has
 * to pass before it may load.
 *
 * WHAT EACH CATEGORY SAYS IS STILL TRUE. The two optional rows describe
 * what they WOULD cover, and say plainly that the shop uses nothing in
 * them yet -- which is the one line that stops this dialog implying a
 * surveillance operation that does not exist.
 *
 * CLOSING IS NOT CONSENTING. The X and Escape both record the same answer
 * as "Reject optional". A dialog that treats dismissal as a yes is the
 * oldest dark pattern there is.
 */
export default function CookieNotice({ lang }: { lang: Lang }) {
  /* Starts hidden and is revealed by an effect, on purpose. This is
     server-rendered into every page and localStorage cannot be read on the
     server -- open by default would flash the dialog at a visitor who
     answered months ago, on every page load. */
  const [show, setShow] = useState(false);
  const [choice, setChoice] = useState<Consent>(NO_CONSENT);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        // null means the question has never been answered. Answering "no
        // to everything" is a different thing and must not re-ask.
        if (readConsent() === null) setShow(true);
      } catch {
        /* Private browsing, or storage blocked. Say nothing rather than
           show a dialog whose answer cannot be kept -- it would be back on
           the next page, for ever. */
      }
    })();
  }, []);

  const decide = useCallback((c: Consent) => {
    saveConsent(c);
    setShow(false);
  }, []);

  // Escape closes, and closing declines. Bound only while it is open.
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") decide(NO_CONSENT); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show, decide]);

  // The dialog takes focus when it opens, so a keyboard or screen-reader
  // user is not left behind on the page underneath it.
  useEffect(() => { if (show) panelRef.current?.focus(); }, [show]);

  if (!show) return null;

  const rows: Array<{
    key: OptionalCategory; label: string; note: string;
  }> = OPTIONAL_CATEGORIES.map((key) => ({
    key,
    label: t(key === "analytics" ? "cookieAnalytics" : "cookieMarketing", lang),
    note: t(key === "analytics" ? "cookieAnalyticsNote" : "cookieMarketingNote", lang),
  }));

  return (
    <div className="ck-scrim" role="presentation" onClick={() => decide(NO_CONSENT)}>
      <div
        ref={panelRef}
        className="ck-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ck-title"
        aria-describedby="ck-sub"
        tabIndex={-1}
        /* The scrim closes; the panel must not. Without this, every click
           inside the dialog would fall through to the backdrop and
           dismiss it. */
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ck-head">
          <div>
            <h2 id="ck-title">{t("cookieManage", lang)}</h2>
            <p id="ck-sub" className="hint">{t("cookieManageSub", lang)}</p>
          </div>
          <button type="button" className="ck-x" onClick={() => decide(NO_CONSENT)}
            aria-label={t("cookieClose", lang)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="ck-body">
          {/* Essential: shown as a locked switch rather than hidden, because
              "what does this site store about me" is answered by seeing the
              whole list, including the part nobody gets to turn off. */}
          <div className="ck-row">
            <div className="ck-row-t">
              <b>{t("cookieEssential", lang)}</b>
              <span className="ck-req">{t("cookieRequired", lang)}</span>
            </div>
            <p className="hint">{t("cookieEssentialNote", lang)}</p>
            <span className="ck-sw is-on is-locked" aria-hidden="true"><i /></span>
          </div>

          {rows.map((r) => (
            <label className="ck-row" key={r.key}>
              <div className="ck-row-t"><b>{r.label}</b></div>
              <p className="hint">
                {r.note}{" "}
                {/* The line that keeps this dialog honest. */}
                <span className="ck-none">{t("cookieNoneYet", lang)}</span>
              </p>
              <input
                type="checkbox"
                className="sr"
                checked={choice[r.key]}
                onChange={(e) => setChoice((c) => ({ ...c, [r.key]: e.target.checked }))}
              />
              <span className={"ck-sw" + (choice[r.key] ? " is-on" : "")} aria-hidden="true"><i /></span>
            </label>
          ))}
        </div>

        <div className="ck-foot">
          <Link className="ck-more" href="/legal/terms#privacy">{t("cookieMore", lang)}</Link>
          <div className="ck-acts">
            <button type="button" className="btn btn-sm btn-ghost"
              onClick={() => decide(NO_CONSENT)}>{t("cookieRejectOptional", lang)}</button>
            <button type="button" className="btn btn-sm btn-ghost"
              onClick={() => decide({ analytics: true, marketing: true })}>
              {t("cookieAcceptAll", lang)}
            </button>
            <button type="button" className="btn btn-sm"
              onClick={() => decide(choice)}>{t("cookieSave", lang)}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
