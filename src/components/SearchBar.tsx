"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export default function SearchBar({ lang }: { lang: Lang }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState("");

  useEffect(() => {
    setQ(pathname === "/search" ? params.get("q") || "" : "");
  }, [pathname, params]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    router.push(query ? `/search?q=${encodeURIComponent(query)}` : "/");
  }

  return (
    <form onSubmit={submit} role="search">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("search", lang)}
        aria-label={t("search", lang)}
        autoComplete="off"
      />
      <button type="submit">{t("searchGo", lang)}</button>
    </form>
  );
}
