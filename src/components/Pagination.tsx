import Link from "next/link";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/** Deliberately plain <Link>s rather than a client component that pushes to
 * the router: page 2 of a category is a real, shareable, crawlable URL, and
 * on a 2G connection in Dili a link that the browser handles beats shipping
 * JavaScript to do the same job.
 *
 * Windowed, not exhaustive — a 40-page catalog would otherwise render 40
 * tap targets on a 360px screen. */
export default function Pagination({
  page, pageCount, basePath, params, lang,
}: {
  page: number;
  pageCount: number;
  /** Path without a query string, e.g. "/c/eletronika". */
  basePath: string;
  /** Every other active filter, preserved across page changes. */
  params: Record<string, string | undefined>;
  lang: Lang;
}) {
  if (pageCount <= 1) return null;

  const href = (n: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) sp.set(k, v);
    }
    // Page 1 is the canonical, un-suffixed URL: two addresses for the same
    // first page is a duplicate-content problem and an ugly link to share.
    if (n > 1) sp.set("page", String(n));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  // A window of pages around the current one, always including the first and
  // last so "jump to the end" stays one tap away.
  const windowSize = 2;
  const numbers: number[] = [];
  for (let n = 1; n <= pageCount; n++) {
    if (n === 1 || n === pageCount || Math.abs(n - page) <= windowSize) numbers.push(n);
  }

  return (
    <nav className="pager" aria-label={t("page", lang)}>
      {page > 1 ? (
        <Link className="pager-step" href={href(page - 1)} rel="prev">‹ {t("prevPage", lang)}</Link>
      ) : (
        <span className="pager-step is-off">‹ {t("prevPage", lang)}</span>
      )}

      <span className="pager-nums">
        {numbers.map((n, i) => (
          <span key={n}>
            {/* A gap in the sequence means pages were skipped by the window. */}
            {i > 0 && n - numbers[i - 1] > 1 && <span className="pager-gap">…</span>}
            {n === page ? (
              <span className="pager-n is-now" aria-current="page">{n}</span>
            ) : (
              <Link className="pager-n" href={href(n)}>{n}</Link>
            )}
          </span>
        ))}
      </span>

      {page < pageCount ? (
        <Link className="pager-step" href={href(page + 1)} rel="next">{t("nextPage", lang)} ›</Link>
      ) : (
        <span className="pager-step is-off">{t("nextPage", lang)} ›</span>
      )}
    </nav>
  );
}
