import type { Metadata } from "next";
import { localeMetadata, localePath } from "./locale";
import type { Lang } from "./types";

/* What a catalog listing tells a crawler about itself.
 *
 * /shop, /c/[slug] and /search all render the same grid through
 * CatalogLayout, and every one of them accepts sort, in, min, max, for and
 * page. That is 6 dimensions over one set of products: the same twelve
 * boots, re-ordered and re-sliced, at hundreds of distinct URLs. Left
 * alone, a crawler spends its budget on those permutations instead of the
 * product pages, and the ones it does index compete with each other for
 * the same query.
 *
 * So: the bare path is the page, and every filtered, sorted or paged view
 * of it is noindex,follow -- crawl through it to the products, do not file
 * it. `follow` matters: those views are how a crawler reaches page 40 of
 * the catalog at all.
 *
 * noindex is NOT combined with a cross-URL canonical here. The two are
 * contradictory instructions ("don't index this" plus "credit that one
 * instead"), and Google's own guidance is to send one or the other. The
 * bare path gets the canonical; the variants get the noindex.
 */

/** The query parameters every catalog listing understands. */
export interface ListingSearchParams {
  sort?: string;
  in?: string;
  min?: string;
  max?: string;
  for?: string;
  page?: string;
}

/** True when the URL is showing something other than the whole, default,
 * first page of the listing. `page=1` is the default page written out, not
 * a variant -- treating it as one would noindex a link the paginator
 * itself emits. */
export function isFilteredListing(sp: ListingSearchParams): boolean {
  return Boolean(
    sp.sort ||
    sp.in ||
    sp.min ||
    sp.max ||
    sp.for ||
    (sp.page && sp.page !== "1"),
  );
}

/** Metadata for a listing at `path` that may or may not be filtered. */
export function listingMetadata(input: {
  title: string;
  description?: string;
  path: string;
  searchParams: ListingSearchParams;
  /** The language this URL asked for. Its canonical is itself and its
   * hreflang cluster names the other two -- see lib/locale.ts. */
  lang: Lang;
}): Metadata {
  const filtered = isFilteredListing(input.searchParams);
  return {
    title: input.title,
    description: input.description,
    ...(filtered
      ? { robots: { index: false, follow: true } }
      : localeMetadata(input.lang, input.path)),
    openGraph: {
      type: "website",
      url: localePath(input.lang, input.path),
      title: input.title,
      description: input.description,
    },
  };
}

/** Metadata for a search results page.
 *
 * Always noindex,follow, whatever was typed: a search results page is
 * generated on demand from someone else's query, and indexing it is what
 * Google's own quality guidelines call a "search results in search
 * results" page. It is also how a shop ends up with pages titled after
 * whatever a stranger felt like typing into the box. */
export function searchMetadata(title: string): Metadata {
  return { title, robots: { index: false, follow: true } };
}
