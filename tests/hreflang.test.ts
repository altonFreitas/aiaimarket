import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/* THE SITEMAP AND THE PAGES HAVE TO TELL THE SAME STORY.
 *
 * hreflang is a PAIR of claims, and Google treats a one-sided one as an
 * error rather than as a hint. The sitemap says "/, /tet/ and /pt/ are the
 * same page in three languages"; each of those pages has to say it back, by
 * carrying its own self-referencing canonical and the other two as
 * alternates. One side alone does nothing at best.
 *
 * The homepage was the one-sided case, and it was the most-linked page on
 * the site: sitemap.ts listed it in three languages with alternates, the
 * root layout's metadata had no `alternates` at all, and src/app/page.tsx
 * had no generateMetadata to add one. Nothing failed, nothing was logged,
 * and 1,023 translated strings went on doing no search work.
 *
 * So the two sides are checked against each other here rather than
 * maintained in parallel by hand. Reading the source is crude; running
 * Next's metadata resolution in a unit test is not possible, and the crude
 * version is what catches a page being added to one side and not the other.
 */

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const SITEMAP = read("src/app/sitemap.ts");

/** Every path the sitemap emits a locale cluster for, as a route shape:
 * `/c/${c.slug}` is read as the route `/c/[slug]`, which is the directory
 * that actually serves it. */
function pathsPromisingAlternates(): string[] {
  const out = new Set<string>();
  for (const m of SITEMAP.matchAll(/forEveryLocale\(\s*(`[^`]*`|"[^"]*")/g)) {
    const raw = m[1].slice(1, -1);
    out.add(raw.replace(/\$\{[^}]*\}/g, "[slug]"));
  }
  return [...out].sort();
}

/** The page file that serves a route. */
function pageFor(route: string): string {
  return route === "/" ? "src/app/page.tsx" : `src/app${route}/page.tsx`;
}

/** Does this page confirm its alternates -- itself, or through a helper it
 * hands its metadata to? One level of indirection, which is all this app
 * uses (listingMetadata, for the three catalog listings). */
function confirmsAlternates(file: string): boolean {
  const src = read(file);
  if (/localeMetadata\s*\(/.test(src)) return true;
  for (const helper of ["listingMetadata", "searchMetadata"]) {
    if (new RegExp(`${helper}\\s*\\(`).test(src)) {
      if (/localeMetadata\s*\(/.test(read("src/lib/listingMeta.ts"))) return true;
    }
  }
  return false;
}

describe("what the sitemap promises", () => {
  const routes = pathsPromisingAlternates();

  it("is more than nothing, so the checks below are not vacuous", () => {
    // A regex that silently stopped matching would turn every assertion
    // in this file into a loop over an empty list.
    expect(routes.length).toBeGreaterThanOrEqual(4);
  });

  it("names routes that actually exist", () => {
    for (const route of routes) {
      expect([route, existsSync(resolve(ROOT, pageFor(route)))]).toEqual([route, true]);
    }
  });

  it("is confirmed by every page it names", () => {
    /* THE ASSERTION THIS FILE EXISTS FOR. A page added to the sitemap and
       not given localeMetadata fails here, which is the mistake that had
       already been made on the homepage and on nothing else. */
    for (const route of routes) {
      expect([route, confirmsAlternates(pageFor(route))]).toEqual([route, true]);
    }
  });

  it("covers the public pages a shopper is served in three languages", () => {
    // Named rather than counted: a page type dropped from the sitemap
    // should fail as its own name, not as an off-by-one.
    for (const route of ["/", "/shop", "/c/[slug]", "/p/[slug]",
                         "/store/[slug]", "/legal/[slug]"]) {
      expect([route, routes.includes(route)]).toEqual([route, true]);
    }
  });
});

describe("the search page, which is deliberately the exception", () => {
  it("is noindex, and therefore carries no hreflang", () => {
    /* NOT AN OVERSIGHT, and the audit that asked for it was wrong.
     *
     * A results page is generated from a stranger's query, and indexing it
     * is what Google's own guidance calls "search results in search
     * results". hreflang on a noindex page is two contradictory
     * instructions: "these three are one page" and "file none of them".
     * Adding it here would have been a change for the worse. */
    expect(read("src/lib/listingMeta.ts"))
      .toMatch(/searchMetadata[\s\S]{0,200}robots:\s*\{\s*index:\s*false/);
    expect(read("src/app/search/page.tsx")).toMatch(/searchMetadata\(/);
  });

  it("is not in the sitemap either", () => {
    // The two halves agree about the exception as well as about the rule.
    expect(pathsPromisingAlternates()).not.toContain("/search");
  });
});

describe("a filtered listing", () => {
  it("is noindex instead of alternated, not both", () => {
    /* /shop?sort=price is not a fourth language of /shop. listingMetadata
       sends ONE instruction -- the bare path gets the cluster, a filtered
       view gets noindex,follow -- because a cross-URL canonical plus
       noindex is the contradictory pair Google asks you not to send. */
    const src = read("src/lib/listingMeta.ts");
    expect(src).toMatch(/filtered[\s\S]{0,120}robots:\s*\{\s*index:\s*false[\s\S]{0,120}localeMetadata/);
  });
});
