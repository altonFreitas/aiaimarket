import Link from "next/link";
import {
  toggleFilter, attributeFilterParams, hasFilters,
  type AttributeFilters as Filters,
} from "@/lib/attributeFilterParams";
import type { CatalogFilter } from "@/lib/data/attributeFilters";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* THE FILTERS A CATEGORY OFFERS, NONE OF THEM WRITTEN BY HAND.
 *
 * Section 19. Shoes offer Brand, Size, Colour and Waterproof; sofas offer
 * Material, Number of Seats and Room Type. Both lists come out of the
 * attributes their product types ask for, so a category added next year
 * gets filters without anybody opening this file.
 *
 * LINKS, NOT CHECKBOXES, and that is the whole design. A filtered
 * catalogue is a PLACE: it can be bookmarked, opened in a second tab, sent
 * to somebody, and found by a search engine. It also means the page needs
 * no JavaScript at all to filter -- which on a phone on a slow connection
 * in Dili is the difference between a filter that works and one that
 * does not.
 *
 * Every link carries the other filters with it, so ticking Black then
 * Leather narrows twice rather than replacing the first choice.
 */

export default function AttributeFilters({
  filters, active, basePath, params, lang,
}: {
  /** What this category can be filtered by, with counts. */
  filters: CatalogFilter[];
  /** What is filtered right now. */
  active: Filters;
  basePath: string;
  /** The catalogue's own parameters -- sort, price, in-stock -- which
   * every filter link has to preserve or picking a colour would silently
   * reset the sort. */
  params: Record<string, string | undefined>;
  lang: Lang;
}) {
  if (!filters.length) return null;

  const href = (next: Filters) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      // `page` is deliberately dropped: page four of the old result set is
      // rarely page four of the new one, and is often past its end.
      if (v && k !== "page" && !k.startsWith("a_")) q.set(k, v);
    }
    for (const [k, v] of Object.entries(attributeFilterParams(next))) q.set(k, v);
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  return (
    <div className="filters">
      <div className="filters-head">
        <h2>{t("filters", lang)}</h2>
        {hasFilters(active) && (
          <Link className="btn-link" href={href({})}>{t("clearFilters", lang)}</Link>
        )}
      </div>

      {filters.map((f) => (
        <details key={f.slug} className="filter-group" open={!!active[f.slug]?.length}>
          <summary>
            {f.name}
            {f.unit && <span className="hint"> ({f.unit})</span>}
            {active[f.slug]?.length ? (
              <span className="pill ok">{active[f.slug].length}</span>
            ) : null}
          </summary>
          <ul>
            {f.options.map((o) => {
              const on = active[f.slug]?.includes(o.value) ?? false;
              return (
                <li key={o.value}>
                  <Link
                    href={href(toggleFilter(active, f.slug, o.value))}
                    className={"filter-opt" + (on ? " is-on" : "")}
                    /* aria-pressed rather than a checkbox role: it IS a
                       link, and telling a screen reader otherwise would
                       promise behaviour it does not have. */
                    aria-pressed={on}
                  >
                    <span>{o.value}</span>
                    <span className="hint">{o.count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </details>
      ))}
    </div>
  );
}
