import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* A panel that folds away.
 *
 * Built on <details>/<summary> and NOT on useState, so it is a server
 * component with no JavaScript behind it: it opens on a keyboard, it opens
 * with scripting off, and the browser handles the focus and the ARIA that a
 * hand-rolled disclosure has to remember to. The chevron is decoration over
 * behaviour that already worked.
 *
 * THE SUMMARY LINE CARRIES THE ANSWER. Folding a panel to shorten a page is
 * only an improvement if it does not also hide the thing the panel was
 * there to say -- "five payment methods not set up" is exactly what somebody
 * opening Settings before launch needs, and a closed drawer marked "Payment
 * methods" tells them nothing. So every fold shows a one-line status beside
 * its title, and closing it costs the detail, never the headline.
 */
export default function Fold({
  lang, title, status, tone = "muted", defaultOpen = false, children,
}: {
  lang: Lang;
  title: string;
  /** The one fact worth reading with the panel shut. */
  status?: string;
  tone?: "muted" | "ok" | "warn";
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="panel fold" open={defaultOpen}>
      <summary className="fold-head">
        <span className="fold-title">{title}</span>
        {status && <span className={"pill " + tone}>{status}</span>}
        <span className="fold-toggle" aria-hidden="true">
          {/* Circle with an arrow down; rotated by CSS when open. */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M8 11l4 4 4-4" />
          </svg>
        </span>
        {/* The accessible name says what the control does. The chevron on
            its own is a guess for anyone not looking at it. */}
        <span className="sr-only">{t("foldToggle", lang)}</span>
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}
