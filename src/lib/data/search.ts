import { cache } from "react";
import { supabaseAnon } from "@/lib/supabase/anon";
import { getLiveProducts } from "./public";
import { effectivePrice, ratingAverage } from "@/lib/utils";
import type { Product } from "@/lib/types";

/* ---------------------------------------------------------------------------
 * Catalog search.
 *
 * One entry point -- searchCatalog() -- behind which sit two implementations:
 *
 *   1. search_products(), a ranked/filtered/paginated Postgres function
 *      (supabase/marketplace-v2.sql). This is the real one. It does accent
 *      folding, prefix matching, relevance ranking and LIMIT/OFFSET in the
 *      database, so a page of results costs one round trip regardless of how
 *      large the catalog gets.
 *
 *   2. An in-memory filter over getLiveProducts(), which is what this app did
 *      everywhere before. Kept ONLY as the fallback for a database where
 *      marketplace-v2.sql has not been run yet -- deploying the code and
 *      running the SQL are two separate acts, and the storefront must not
 *      break in the window between them.
 *
 * Both paths honour the same filters, the same sorts and the same pagination,
 * so which one answered is invisible to callers apart from the `indexed` flag
 * (used to hide the features the fallback genuinely cannot do, like
 * relevance ranking and "did you mean").
 * ------------------------------------------------------------------------ */

export type CatalogSort = "relevance" | "new" | "low" | "high" | "rating";

const SORTS: readonly CatalogSort[] = ["relevance", "new", "low", "high", "rating"];

export const DEFAULT_PER_PAGE = 24;
const MAX_PER_PAGE = 100;

/** How deep a result set is counted and paged.
 *
 * THE SAME NUMBER AS v_cap IN search_products, and it has to be: the
 * function returns at most cap+1 rows' worth of count, and this is what
 * reads that as "more than a thousand". tests/searchCap.test.ts fails if
 * the two drift, because a mismatch would show the shopper a page number
 * that returns nothing.
 *
 * Why there is a cap at all: counting the whole match set made the catalog
 * page -- where the match set is the entire catalog -- read every product
 * to show twenty-four. Measured at 60,000 products, that page went from
 * 94.4ms to 2.1ms when the count stopped being exhaustive. What it costs
 * is the difference between "60,001 results" and "1,000+ results", and
 * pages past 42, which nobody opens. */
export const SEARCH_TOTAL_CAP = 1000;

/** Coerces whatever arrived in a URL query string into a sort this app
 * actually implements. `relevance` only makes sense with a search term, so a
 * bare catalog page with no `q` falls back to newest-first. */
export function parseSort(raw: string | undefined, hasQuery: boolean): CatalogSort {
  if (raw && (SORTS as readonly string[]).includes(raw)) return raw as CatalogSort;
  return hasQuery ? "relevance" : "new";
}

/** `?page=` is user input, so it is clamped rather than trusted: a negative
 * or non-numeric page becomes 1. The upper bound is applied later, once the
 * result count is known. */
export function parsePage(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 1 ? n : 1;
}

/** Parses a price filter. Returns null for anything that isn't a usable
 * non-negative number, which is the same as "no filter". */
export function parsePrice(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface CatalogQuery {
  q?: string;
  categoryIds?: string[];
  sellerIds?: string[];
  minPrice?: number | null;
  maxPrice?: number | null;
  inStockOnly?: boolean;
  sort?: CatalogSort;
  page?: number;
  perPage?: number;
  /** The products that survived the attribute filters, already intersected
   * -- see lib/data/attributeFilters.ts. Null or absent means no attribute
   * filter at all, which is NOT the same as an empty array: that means the
   * filters matched nothing, and the right answer is no products rather
   * than every product. */
  attributeIds?: string[] | null;
}

export interface CatalogResult {
  products: Product[];
  /** How many matched -- exact up to SEARCH_TOTAL_CAP, and the cap itself
   * when there are more. Never a number larger than the cap, so a caller
   * that prints it without checking `totalCapped` understates rather than
   * invents. */
  total: number;
  /** True when more matched than were counted. The storefront turns this
   * into "1,000+": printing a capped figure as though it were a total
   * would be a made-up number, which is the one thing worse than an
   * approximate one. */
  totalCapped: boolean;
  page: number;
  perPage: number;
  pageCount: number;
  /** False when the Postgres search function was unavailable and the
   * in-memory fallback answered instead. Callers use this to hide the
   * things only the indexed path can do. */
  indexed: boolean;
}

interface SearchRow {
  product: Product;
  total_count: number | string;
  rank: number;
}

/** Request-level memoization, matching the pattern in lib/data/public.ts: a
 * page that renders the same result set twice (grid + a count in the header)
 * queries once. Not cached across requests -- unlike the catalog reads, a
 * search result is keyed by too many dimensions for a shared cache entry to
 * pay for itself. */
export const searchCatalog = cache(searchCatalogUncached);

async function searchCatalogUncached(query: CatalogQuery): Promise<CatalogResult> {
  const page = Math.max(1, Math.floor(query.page || 1));
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Math.floor(query.perPage || DEFAULT_PER_PAGE)));
  const sort = query.sort || (query.q ? "relevance" : "new");

  try {
    const sb = supabaseAnon();
    const { data, error } = await sb.rpc("search_products", {
      q: query.q || "",
      category_ids: query.categoryIds?.length ? query.categoryIds : null,
      seller_ids: query.sellerIds?.length ? query.sellerIds : null,
      min_price: query.minPrice ?? null,
      max_price: query.maxPrice ?? null,
      in_stock_only: !!query.inStockOnly,
      sort,
      lim: perPage,
      off: (page - 1) * perPage,
      /* Sent only when there is one to send. A database that has not run
         supabase/attribute-filters.sql has the ten-argument function, and
         naming an argument it does not have fails the call -- which would
         push EVERY search onto the slow in-memory path rather than just
         the ones using this filter. */
      ...(query.attributeIds != null ? { id_filter: query.attributeIds } : {}),
    });
    // A missing function, a missing column, a revoked grant -- all of them
    // mean the same thing to this caller: the indexed path isn't there yet.
    if (error) throw error;

    const rows = (data as SearchRow[]) || [];
    /* The function counts one past the cap on purpose, so this can tell
       "exactly a thousand" from "more than a thousand". Nothing outside
       this line ever sees the cap+1. */
    const counted = rows.length ? Number(rows[0].total_count) || 0 : 0;
    return {
      products: rows.map((r) => r.product),
      ...capTotal(counted, perPage),
      page,
      perPage,
      indexed: true,
    };
  } catch {
    return fallbackSearch(query, page, perPage, sort);
  }
}

/** The pre-migration behaviour, kept honest: same filters, same sort order,
 * same pagination arithmetic as the SQL above -- only slower, unranked and
 * accent-sensitive. */
async function fallbackSearch(
  query: CatalogQuery, page: number, perPage: number, sort: CatalogSort
): Promise<CatalogResult> {
  const all = await getLiveProducts();
  const q = (query.q || "").trim().toLowerCase();
  const cats = query.categoryIds?.length ? new Set(query.categoryIds) : null;
  const sellers = query.sellerIds?.length ? new Set(query.sellerIds) : null;
  /* The attribute filter applies here too. Null means no filter; an EMPTY
     set means the filters matched nothing, and every product must fail --
     which `has()` on an empty set does, so both cases fall out of the same
     line without a special case. */
  const attrIds = query.attributeIds != null ? new Set(query.attributeIds) : null;

  let hits = all.filter((p) => {
    if (q && !`${p.name} ${p.description} ${(p.tags || []).join(" ")}`.toLowerCase().includes(q)) {
      return false;
    }
    if (cats && !cats.has(p.category_id || "")) return false;
    if (sellers && !sellers.has(p.seller_id)) return false;
    if (attrIds && !attrIds.has(p.id)) return false;
    if (query.inStockOnly && p.stock_status === "out") return false;
    const price = effectivePrice(p);
    if (query.minPrice != null && price < query.minPrice) return false;
    if (query.maxPrice != null && price > query.maxPrice) return false;
    return true;
  });

  hits = sortProducts(hits, sort);

  const start = (page - 1) * perPage;
  return {
    products: hits.slice(start, start + perPage),
    /* THE SAME CAP as the indexed path, although this one already knows the
       exact answer. The two paths differ in speed and in ranking and are
       not supposed to differ in what they SAY -- a shop whose migration has
       not run would otherwise see a total, and pages, that vanish the day
       it does. */
    ...capTotal(hits.length, perPage),
    page,
    perPage,
    indexed: false,
  };
}

/** The total, the flag and the page count, from a raw match count.
 *
 * One place, because the two search paths have to agree and because the
 * page count is where getting this wrong is visible: a pager offering page
 * 2,501 of a result set counted to 1,000 sends the shopper to an empty
 * grid. */
export function capTotal(counted: number, perPage: number): {
  total: number; totalCapped: boolean; pageCount: number;
} {
  const totalCapped = counted > SEARCH_TOTAL_CAP;
  const total = totalCapped ? SEARCH_TOTAL_CAP : counted;
  return { total, totalCapped, pageCount: Math.max(1, Math.ceil(total / perPage)) };
}

/** Exported for the fallback path and for its unit tests. `relevance` has no
 * meaning without the tsvector rank, so it degrades to newest-first here --
 * the same thing the SQL does when there is no search term. */
export function sortProducts(products: Product[], sort: CatalogSort): Product[] {
  const byNewest = (a: Product, b: Product) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  const a = products.slice();
  if (sort === "low") a.sort((x, y) => effectivePrice(x) - effectivePrice(y) || byNewest(x, y));
  else if (sort === "high") a.sort((x, y) => effectivePrice(y) - effectivePrice(x) || byNewest(x, y));
  else if (sort === "rating") {
    // Unrated products sort last rather than as zero -- a listing nobody has
    // reviewed is not a one-star listing.
    a.sort((x, y) => (ratingAverage(y) ?? -1) - (ratingAverage(x) ?? -1) || byNewest(x, y));
  } else a.sort(byNewest);
  return a;
}

export interface Suggestion { name: string; slug: string; }

/** "Did you mean" for a search that found nothing. Trigram similarity, so it
 * catches the typo and the near-miss ("kamra" -> "kamera") that full-text
 * matching by design does not. Returns [] rather than throwing on a database
 * without marketplace-v2.sql -- an absent suggestion is a missing nicety, not
 * an error page. */
export async function suggestProducts(q: string, limit = 5): Promise<Suggestion[]> {
  if (!q.trim()) return [];
  try {
    const sb = supabaseAnon();
    const { data, error } = await sb.rpc("suggest_products", { q: q.trim(), lim: limit });
    if (error) return [];
    return ((data as Suggestion[]) || []).map((s) => ({ name: s.name, slug: s.slug }));
  } catch {
    return [];
  }
}
