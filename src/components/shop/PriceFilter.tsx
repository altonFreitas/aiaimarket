"use client";
import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/** Price is typed, not picked, so it stays local state until submitted --
 * navigating on every keystroke would fire a request per digit.
 *
 * Keyed on the URL values by its caller, so that navigating (back button,
 * "clear filters", a link with a range already in it) remounts it with the
 * new defaults. React's own answer to "reset state when a prop changes",
 * and cheaper than an effect that writes state on every URL change.
 *
 * Every change drops `page`: narrowing a filter while on page five lands
 * the shopper on an empty page and looks like the site lost their results. */
export default function PriceFilter({ lang }: { lang: Lang }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [min, setMin] = useState(params.get("min") || "");
  const [max, setMax] = useState(params.get("max") || "");

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams(params.toString());
    const set = (k: string, v: string) => (v ? p.set(k, v) : p.delete(k));
    set("min", min.trim());
    set("max", max.trim());
    p.delete("page");
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <form className="fprice" onSubmit={apply}>
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
