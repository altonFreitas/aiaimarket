"use client";
import Link from "next/link";
import { clientLang } from "@/lib/clientLang";
import { t } from "@/lib/i18n";

/* What a visitor sees when a page throws.
 *
 * Without this file, Next shows its own screen: a stack trace in
 * development and a bare "Application error" in production, in neither
 * case inside the shop, and with no way onward except the back button. A
 * shopper who meets that has no reason to think the site is a real one.
 *
 * It renders inside whatever layout it is nested under, so an error in the
 * admin keeps the admin navigation and one in the shop keeps the header.
 * That is the whole reason to put it here rather than to write a page per
 * section.
 *
 * The error's own message is deliberately NOT shown. Next redacts it in
 * production anyway, and what it says on a server error is for the log,
 * not for a shopper. The digest is shown because it is the one thing that
 * lets somebody reading the server log find this exact failure. */
export default function ShopError(
  { error, reset }: { error: Error & { digest?: string }; reset: () => void }
) {
  const lang = clientLang();
  return (
    <div className="wrap">
      <div className="empty">
        <h1>{t("errorTitle", lang)}</h1>
        <p>{t("errorBody", lang)}</p>
        <div className="empty-actions">
          <button className="btn btn-amber" type="button" onClick={reset}>
            {t("errorRetry", lang)}
          </button>
          <Link className="btn btn-ghost" href="/">{t("goHome", lang)}</Link>
        </div>
        {error.digest && (
          <p className="hint mono" style={{ marginTop: 12 }}>
            {t("errorRef", lang)}: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
