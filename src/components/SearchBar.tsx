"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export default function SearchBar({ lang }: { lang: Lang }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // The URL is the source of truth for what was searched; local state only
  // exists to hold what the user has typed SINCE then. Deriving it (with a
  // key that resets the field on navigation) replaces a setState-in-effect
  // that re-rendered the header twice on every route change.
  const urlQ = pathname === "/search" ? params.get("q") || "" : "";
  const [typed, setTyped] = useState<string | null>(null);
  const q = typed ?? urlQ;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    setTyped(null); // hand control back to the URL
    router.push(query ? `/search?q=${encodeURIComponent(query)}` : "/");
  }

  return (
    <form onSubmit={submit} role="search">
      <input
        type="search"
        value={q}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={t("search", lang)}
        aria-label={t("search", lang)}
        autoComplete="off"
      />
      <button type="submit">{t("searchGo", lang)}</button>
    </form>
  );
}
