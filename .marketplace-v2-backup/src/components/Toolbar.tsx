"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export default function Toolbar({ count, lang }: { count: number; lang: Lang }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const sort = params.get("sort") || "new";
  const inStock = params.get("in") === "1";

  function update(next: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    Object.entries(next).forEach(([k, v]) => (v === null ? p.delete(k) : p.set(k, v)));
    router.push(`${pathname}?${p.toString()}`);
  }

  return (
    <div className="bar">
      <select
        aria-label={t("sort", lang)}
        value={sort}
        onChange={(e) => update({ sort: e.target.value === "new" ? null : e.target.value })}
      >
        <option value="new">{t("sortNew", lang)}</option>
        <option value="low">{t("sortLow", lang)}</option>
        <option value="high">{t("sortHigh", lang)}</option>
      </select>
      <label className="toggle">
        <input
          type="checkbox"
          checked={inStock}
          onChange={(e) => update({ in: e.target.checked ? "1" : null })}
        />{" "}
        {t("onlyIn", lang)}
      </label>
      <span className="count">
        {count} {t("results", lang)}
      </span>
    </div>
  );
}
