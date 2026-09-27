"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* HOW MANY, AND IN WHAT ORDER -- the one bar above the grid.
 *
 * What used to stand here as well: an in-stock tick, a price range and a
 * clear-filters button. They are filters, and they are now where the
 * filters are, so this bar answers the two questions a shopper asks of a
 * result rather than of a catalogue.
 *
 * THE FILTER BUTTON IS A LINK TO AN ANCHOR, not a button that opens a
 * panel. On a narrow screen the rail is off-canvas and :target brings it
 * back, which means the filters open with JavaScript switched off -- the
 * same reason every filter in the rail is a link. See .frail in
 * globals.css.
 */
export default function ShopBar({
  count, countCapped = false, lang, showRelevance = false, activeFilters = 0,
}: {
  count: number;
  /** True when more matched than were counted -- see SEARCH_TOTAL_CAP.
   * The "+" is the whole point: the catalogue stopped counting at a
   * thousand so the page could load, and printing 1,000 flat would be a
   * number the shop does not have. */
  countCapped?: boolean;
  lang: Lang;
  /** Relevance only means something when there is a search term to be
   * relevant to, so /shop and /c/[slug] don't offer it. */
  showRelevance?: boolean;
  /** How many filters are on, for the badge on the button. */
  activeFilters?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const sort = params.get("sort") || (showRelevance ? "relevance" : "new");

  function setSort(v: string) {
    const p = new URLSearchParams(params.toString());
    p.set("sort", v);
    p.delete("page");
    router.push(`${pathname}?${p.toString()}`);
  }

  const found = t("productsFound", lang)
    .replace("{n}", `${count}${countCapped ? "+" : ""}`);

  return (
    <div className="shop-bar">
      <p className="shop-found">{found}</p>

      <a className="btn btn-sm btn-ghost shop-filter-btn" href="#shop-filters">
        {t("filters", lang)}
        {activeFilters > 0 && <span className="pill ok">{activeFilters}</span>}
      </a>

      <label className="shop-sort">
        <span className="shop-sort-lb">{t("sortBy", lang)}</span>
        <select aria-label={t("sort", lang)} value={sort}
          onChange={(e) => setSort(e.target.value)}>
          {showRelevance && <option value="relevance">{t("sortRelevance", lang)}</option>}
          <option value="new">{t("sortNew", lang)}</option>
          <option value="popular">{t("sortPopular", lang)}</option>
          <option value="deal">{t("sortDeal", lang)}</option>
          <option value="low">{t("sortLow", lang)}</option>
          <option value="high">{t("sortHigh", lang)}</option>
          <option value="rating">{t("sortRating", lang)}</option>
        </select>
      </label>
    </div>
  );
}
