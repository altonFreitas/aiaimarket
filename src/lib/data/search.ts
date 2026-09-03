import { cache } from "react";
import { matchesAudience, normalizeAudience, type Audience } from "@/lib/audience";
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
  /** "men" or "women". Null/absent means no preference, which shows
   * everything -- including the products nobody has labelled. */
  audience?: Audience | null;
  sort?: CatalogSort;
  page?: number;
  perPage?: number;
}

export interface CatalogResult {
  products: Product[];
  total: number;
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
      // Only sent when there is one to send. A database that has not run
      // supabase/audience-restock.sql has the nine-argument function, and
      // naming an argument it does not have fails the call -- which would
      // push EVERY search onto the slow in-memory path, not just the ones
      // using this filter. Sending it only when it matters means an
      // un-migrated shop keeps its fast search and degrades on this one
      // filter alone.
      ...(query.audience ? { audience_filter: query.audience } : {}),
    });
    // A missing function, a missing column, a revoked grant -- all of them
    // mean the same thing to this caller: the indexed path isn't there yet.
    if (error) throw error;

    const rows = (data as SearchRow[]) || [];
    const total = rows.length ? Number(rows[0].total_count) || 0 : 0;
    return {
      products: rows.map((r) => r.product),
      total,
      page,
      perPage,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
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

  let hits = all.filter((p) => {
    if (q && !`${p.name} ${p.description} ${(p.tags || []).join(" ")}`.toLowerCase().includes(q)) {
      return false;
    }
    if (cats && !cats.has(p.category_id || "")) return false;
    if (sellers && !sellers.has(p.seller_id)) return false;
    if (query.inStockOnly && p.stock_status === "out") return false;
    if (!matchesAudience(normalizeAudience(p.audience), query.audience ?? null)) return false;
    const price = effectivePrice(p);
    if (query.minPrice != null && price < query.minPrice) return false;
    if (query.maxPrice != null && price > query.maxPrice) return false;
    return true;
  });

  hits = sortProducts(hits, sort);

  const total = hits.length;
  const start = (page - 1) * perPage;
  return {
    products: hits.slice(start, start + perPage),
    total,
    page,
    perPage,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
    indexed: false,
  };
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
