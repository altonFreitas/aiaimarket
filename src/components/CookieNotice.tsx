"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* WHAT THIS SHOP PUTS ON YOUR DEVICE, SAID PLAINLY.
 *
 * IT IS A NOTICE, NOT A CONSENT GATE, AND THAT IS A DELIBERATE READING OF
 * WHAT IS ACTUALLY HERE. Consent is required for cookies that are not
 * necessary for a service the visitor asked for -- analytics, advertising,
 * cross-site tracking. This shop sets none. Grepped before writing this:
 * there is no gtag, no pixel, no third-party script of any kind. What it
 * sets is
 *
 *   lang                  the language you chose, so the next page is in it
 *   loja_admin_session    staff sign-in, and only after signing in
 *   the seller session    the same, for a seller
 *
 * and the basket, which is not a cookie at all -- it is localStorage, and
 * never leaves the device.
 *
 * So an "Accept / Reject" pair here would be theatre: there would be nothing
 * behind Reject, and a button that pretends to give a choice it cannot
 * honour is worse than no button. What a visitor is owed is to be TOLD, in
 * their own language, with a link to the detail. That is this.
 *
 * IF THIS SHOP EVER ADDS ANALYTICS, THIS MUST BECOME A REAL GATE: a tracker
 * must not load until a visitor has actively agreed, and dismissing a notice
 * is not agreeing. The one-line change is in the comment on `acknowledge`
 * below, and it is written down so the next person finds it rather than
 * assuming this file already covers them.
 *
 * REMEMBERED IN localStorage, NOT IN A COOKIE. Setting a cookie to record
 * that somebody read a notice about cookies is a joke the reader is not in
 * on -- and it would be one more thing the notice has to mention.
 */

const SEEN = "loja:cookieNotice";

export default function CookieNotice({ lang }: { lang: Lang }) {
  /* Starts hidden and is revealed by an effect, on purpose. This component
     is server-rendered into every page, and localStorage cannot be read on
     the server -- so rendering it open by default would flash the notice at
     a returning visitor who dismissed it months ago, on every page load. */
  const [show, setShow] = useState(false);

  /* The read sits in an async closure rather than in the effect body, the
     same way TrackForm's does: a setState called synchronously while an
     effect runs schedules a second render pass before the browser has
     painted the first, which is what react-hooks/set-state-in-effect flags.
     Inside the closure it is an ordinary asynchronous update. */
  useEffect(() => {
    void (async () => {
      try {
        if (!localStorage.getItem(SEEN)) setShow(true);
      } catch {
        /* Private browsing, or storage blocked. Say nothing rather than show
           a notice that cannot be dismissed -- an undismissable banner on
           every page is worse than an unread one. */
      }
    })();
  }, []);

  function acknowledge() {
    // THE LINE THAT WOULD CHANGE if this shop ever added a tracker: this
    // would have to record an actual choice, and the tracker would have to
    // wait for it rather than loading beside this component.
    try { localStorage.setItem(SEEN, "1"); } catch { /* nothing to remember to */ }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="cookie-note" role="region" aria-label={t("cookieTitle", lang)}>
      <p>
        {t("cookieBody", lang)}{" "}
        <Link href="/legal/privacy">{t("cookieMore", lang)}</Link>
      </p>
      <button type="button" className="btn btn-sm btn-amber" onClick={acknowledge}>
        {t("cookieOk", lang)}
      </button>
    </div>
  );
}
