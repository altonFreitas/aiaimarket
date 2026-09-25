"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export default function SearchBar({
  lang, autoFocus = false, onSubmit,
}: {
  lang: Lang;
  /** The phone's search overlay opens for one reason, so the caret belongs
   * in the field without a second tap. */
  autoFocus?: boolean;
  /** Lets whatever is holding this form close itself once a search is on
   * its way -- deterministic, rather than watching for the navigation to
   * land and guessing. */
  onSubmit?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // The URL is the source of truth for what was searched; local state only
  // exists to hold what has been typed SINCE then, including while a
  // search is in flight. Deriving it replaces a setState-in-effect that
  // re-rendered the header twice on every route change.
  const urlQ = pathname === "/search" ? params.get("q") || "" : "";
  const [typed, setTyped] = useState<string | null>(null);

  /* CONTROL GOES BACK TO THE URL ONLY ONCE THE URL HAS MOVED.
   *
   * THE BUG THIS FIXES: submit() used to clear `typed` immediately, on the
   * reasoning that the URL was about to become the source of truth. But
   * router.push is asynchronous -- the results have to be fetched -- and
   * until it lands, `urlQ` is still whatever the OLD address said, which
   * from the homepage is the empty string. So typing "sapato" and pressing
   * Search emptied the box, left it empty for as long as the search took,
   * and refilled it when the results arrived. The one moment a shopper
   * most wants to see what they asked for is the moment it vanished.
   *
   * The release is keyed on the ADDRESS CHANGING, not on it matching what
   * was typed. Matching would be enough for a search that lands, and would
   * strand the box on a stale query for somebody who pressed Search and
   * then tapped Catalog before the results came back -- the field would go
   * on offering "sapato" on every page afterwards.
   *
   * Adjusted during render rather than in an effect, the same way MegaNav
   * closes itself on navigation: React re-runs this component immediately
   * with the corrected state, so there is no frame where the box and the
   * address bar disagree. */
  const here = pathname + "?" + (params.get("q") ?? "");
  const [shownFor, setShownFor] = useState(here);
  if (here !== shownFor) {
    setShownFor(here);
    setTyped(null);
  }

  const q = typed ?? urlQ;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    // `typed` deliberately survives this, so the box keeps showing the
    // query while the results are on their way.
    setTyped(query);
    router.push(query ? `/search?q=${encodeURIComponent(query)}` : "/");
    onSubmit?.();
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
        autoFocus={autoFocus}
      />
      {/* A MAGNIFIER INSIDE THE FIELD, not a filled button beside it.
          The amber button was the second loudest thing in the header
          after the cart, for an action a shopper reaches by pressing
          Enter anyway. It stays a real submit button -- it is how the
          form is sent without a keyboard -- and keeps its accessible
          name; only the label is now the icon. */}
      <button type="submit" aria-label={t("searchGo", lang)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" />
        </svg>
      </button>
    </form>
  );
}
