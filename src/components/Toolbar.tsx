"use client";
import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { t } from "@/lib/i18n";
import { parseAudienceFilter } from "@/lib/audience";
import type { Lang } from "@/lib/types";

/** Catalog controls: sort, in-stock toggle, price range.
 *
 * Every control resets `page` to 1 when it changes. Without that, narrowing
 * a filter while on page 5 lands the shopper on an empty page and looks like
 * the site lost their results. */
export default function Toolbar({
  count, lang, showRelevance = false,
}: {
  count: number;
  lang: Lang;
  /** Relevance only means something when there is a search term to be
   * relevant to, so /shop and /c/[slug] don't offer it. */
  showRelevance?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const sort = params.get("sort") || (showRelevance ? "relevance" : "new");
  const inStock = params.get("in") === "1";
  // Read through the same parser the server uses, so a hand-edited URL
  // ("?for=male") shows the control in the state the results are actually
  // in rather than in the one the URL claims.
  const audience = parseAudienceFilter(params.get("for"));
  const urlMin = params.get("min") || "";
  const urlMax = params.get("max") || "";

  function update(next: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    Object.entries(next).forEach(([k, v]) => (v === null ? p.delete(k) : p.set(k, v)));
    p.delete("page");
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const hasFilters = inStock || urlMin !== "" || urlMax !== "" || audience !== null;

  return (
    <div className="bar">
      <select
        aria-label={t("sort", lang)}
        value={sort}
        onChange={(e) => update({ sort: e.target.value })}
      >
        {showRelevance && <option value="relevance">{t("sortRelevance", lang)}</option>}
        <option value="new">{t("sortNew", lang)}</option>
        <option value="low">{t("sortLow", lang)}</option>
        <option value="high">{t("sortHigh", lang)}</option>
        <option value="rating">{t("sortRating", lang)}</option>
      </select>

      <select
        aria-label={t("audienceLabel", lang)}
        value={audience ?? ""}
        onChange={(e) => update({ for: e.target.value || null })}
      >
        <option value="">{t("audienceAny", lang)}</option>
        <option value="men">{t("audienceMen", lang)}</option>
        <option value="women">{t("audienceWomen", lang)}</option>
      </select>

      <label className="toggle">
        <input
          type="checkbox"
          checked={inStock}
          onChange={(e) => update({ in: e.target.checked ? "1" : null })}
        />{" "}
        {t("onlyIn", lang)}
      </label>

      {/* Keyed on the URL values so that navigating (back button, "clear
          filters", a link with a price range already in it) remounts the
          inputs with the new defaults. React's own answer to "reset state
          when a prop changes" — cheaper and less error-prone than an effect
          that writes state on every URL change. */}
      <PriceFilter
        key={`${urlMin}|${urlMax}`}
        lang={lang} initialMin={urlMin} initialMax={urlMax}
        onApply={(min, max) => update({ min: min || null, max: max || null })}
      />

      {hasFilters && (
        <button
          className="btn btn-sm btn-ghost" type="button"
          onClick={() => update({ in: null, min: null, max: null, for: null })}
        >
          {t("clearFilters", lang)}
        </button>
      )}

      <span className="count">
        {count} {t("results", lang)}
      </span>
    </div>
  );
}

/** Price is typed, not picked, so it stays local state until submitted --
 * navigating on every keystroke would fire a request per digit. */
function PriceFilter({
  lang, initialMin, initialMax, onApply,
}: {
  lang: Lang;
  initialMin: string;
  initialMax: string;
  onApply: (min: string, max: string) => void;
}) {
  const [min, setMin] = useState(initialMin);
  const [max, setMax] = useState(initialMax);

  return (
    <form
      className="price-filter"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(min.trim(), max.trim());
      }}
    >
      <span className="price-filter-label">{t("priceRange", lang)}</span>
      <input
        type="number" inputMode="decimal" min="0" step="0.01"
        aria-label={t("priceMin", lang)} placeholder={t("priceMin", lang)}
        value={min} onChange={(e) => setMin(e.target.value)}
      />
      <span aria-hidden="true">–</span>
      <input
        type="number" inputMode="decimal" min="0" step="0.01"
        aria-label={t("priceMax", lang)} placeholder={t("priceMax", lang)}
        value={max} onChange={(e) => setMax(e.target.value)}
      />
      <button className="btn btn-sm btn-ghost" type="submit">{t("applyFilters", lang)}</button>
    </form>
  );
}
