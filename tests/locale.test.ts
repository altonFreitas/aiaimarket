import { describe, it, expect } from "vitest";
import {
  LOCALES, DEFAULT_LOCALE, HREFLANG, isLocale, takesLocale,
  splitLocale, localePath, localeAlternates, localeMetadata,
} from "@/lib/locale";

/* THREE LANGUAGES, THREE URLS.
 *
 * 1,023 translated strings were doing zero search work: all three rendered
 * at one URL behind a cookie, so Googlebot indexed whichever it happened to
 * receive and could not reach the other two. These are the rules that fix
 * it, and every one of them is a thing that breaks silently -- a wrong
 * canonical does not throw, it just quietly stops two thirds of the shop
 * being findable.
 */

describe("splitLocale", () => {
  it("takes the prefix off", () => {
    expect(splitLocale("/pt/p/sapatu")).toEqual({ locale: "pt", rest: "/p/sapatu" });
    expect(splitLocale("/en")).toEqual({ locale: "en", rest: "/" });
  });

  it("leaves an unprefixed path alone", () => {
    // Every link already in the application is this shape.
    expect(splitLocale("/p/sapatu")).toEqual({ locale: null, rest: "/p/sapatu" });
    expect(splitLocale("/")).toEqual({ locale: null, rest: "/" });
  });

  it("is not fooled by a slug that looks like a locale", () => {
    // A product called "en" would be /p/en, not a locale prefix. Only the
    // FIRST segment can be one.
    expect(splitLocale("/p/en")).toEqual({ locale: null, rest: "/p/en" });
    expect(splitLocale("/c/pt")).toEqual({ locale: null, rest: "/c/pt" });
  });

  it("is idempotent, so double-prefixing is impossible", () => {
    // localePath builds on splitLocale, which is what stops /pt/pt/shop.
    expect(localePath("pt", localePath("pt", "/shop"))).toBe("/pt/shop");
    expect(localePath("en", localePath("pt", "/shop"))).toBe("/en/shop");
  });
});

describe("takesLocale", () => {
  it("says no to the back office and the API", () => {
    // Tools, not content. Nobody searches for them, they are behind a
    // login, and three URLs each would triple the surface for no gain.
    for (const p of ["/admin", "/admin/orders", "/seller", "/seller/today", "/api/cron/x"]) {
      expect([p, takesLocale(p)]).toEqual([p, false]);
    }
  });

  it("says yes to everything a shopper reads", () => {
    for (const p of ["/", "/shop", "/p/sapatu", "/c/shoes", "/legal/privacy", "/o/ORD-1"]) {
      expect([p, takesLocale(p)]).toEqual([p, true]);
    }
  });

  it("is not fooled by a prefix that is only a prefix", () => {
    // "/administration" is not "/admin".
    expect(takesLocale("/administration")).toBe(true);
    expect(takesLocale("/sellers-guide")).toBe(true);
  });
});

describe("localePath", () => {
  it("prefixes every language, including the default", () => {
    // A default that is NOT prefixed makes one language's URLs shaped
    // differently from the other two, so every link builder, canonical and
    // sitemap entry needs a special case -- and the one that forgets it
    // produces a duplicate.
    expect(localePath("tet", "/shop")).toBe("/tet/shop");
    expect(localePath("pt", "/shop")).toBe("/pt/shop");
    expect(localePath("en", "/shop")).toBe("/en/shop");
  });

  it("handles the homepage without a trailing slash", () => {
    expect(localePath("tet", "/")).toBe("/tet");
  });

  it("refuses to prefix what must not be prefixed", () => {
    expect(localePath("pt", "/admin/orders")).toBe("/admin/orders");
    expect(localePath("pt", "/api/cron/x")).toBe("/api/cron/x");
  });
});

describe("localeAlternates", () => {
  it("names all three plus x-default", () => {
    expect(localeAlternates("/p/sapatu")).toEqual({
      tet: "/tet/p/sapatu",
      "pt-TL": "/pt/p/sapatu",
      en: "/en/p/sapatu",
      "x-default": "/tet/p/sapatu",
    });
  });

  it("uses BCP 47, which is not the cookie value", () => {
    // "pt-TL" says Portuguese as written in Timor-Leste, rather than in
    // Portugal or Brazil.
    expect(HREFLANG.pt).toBe("pt-TL");
    expect(HREFLANG.tet).toBe("tet");
  });

  it("points x-default at the language the shop is actually written in", () => {
    expect(localeAlternates("/")["x-default"]).toBe(localePath(DEFAULT_LOCALE, "/"));
  });

  it("covers every locale, so adding one cannot be half-done", () => {
    const alts = localeAlternates("/shop");
    for (const lang of LOCALES) {
      expect([lang, alts[HREFLANG[lang]]]).toEqual([lang, `/${lang}/shop`]);
    }
  });
});

describe("localeMetadata", () => {
  it("canonicalises each language to ITSELF", () => {
    // Three languages canonicalising to one would tell Google to index
    // only that one, which is the bug this exists to fix.
    for (const lang of LOCALES) {
      const m = localeMetadata(lang, "/p/x");
      expect([lang, m.alternates.canonical]).toEqual([lang, `/${lang}/p/x`]);
    }
  });

  it("ties the three together in both directions", () => {
    // Google requires the cluster to be reciprocal: if tet names en, en
    // must name tet. Building all three from one function is what
    // guarantees that rather than hoping for it.
    const fromTet = localeMetadata("tet", "/p/x").alternates.languages;
    const fromEn = localeMetadata("en", "/p/x").alternates.languages;
    expect(fromTet).toEqual(fromEn);
  });
});

describe("isLocale", () => {
  it("accepts only the three", () => {
    expect(LOCALES.every(isLocale)).toBe(true);
    for (const bad of ["fr", "id", "", undefined, null, "TET", "pt-BR"]) {
      expect([bad, isLocale(bad as string)]).toEqual([bad, false]);
    }
  });
});
