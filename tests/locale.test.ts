import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { STR } from "@/lib/i18n";
import {
  LOCALES, DEFAULT_LOCALE, HREFLANG, isLocale, takesLocale,
  splitLocale, localePath, localeAlternates, localeMetadata,
} from "@/lib/locale";

/* FOUR LANGUAGES, FOUR URLS.
 *
 * 1,023 translated strings were doing zero search work: all three rendered
 * at one URL behind a cookie, so Googlebot indexed whichever it happened to
 * receive and could not reach the other two. These are the rules that fix
 * it, and every one of them is a thing that breaks silently -- a wrong
 * canonical does not throw, it just quietly stops most of the shop being
 * findable.
 *
 * Indonesian was added fourth. The assertions below name locales one by
 * one where the point is a specific URL shape, and loop over LOCALES where
 * the point is that every language is covered -- so the next language to
 * be added fails the loops rather than passing them unnoticed.
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
    // FIRST segment can be one. "id" makes this sharper than it was: it is
    // a plausible slug and a plausible query key, not just a language.
    expect(splitLocale("/p/en")).toEqual({ locale: null, rest: "/p/en" });
    expect(splitLocale("/c/pt")).toEqual({ locale: null, rest: "/c/pt" });
    expect(splitLocale("/p/id")).toEqual({ locale: null, rest: "/p/id" });
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
    // differently from the rest, so every link builder, canonical and
    // sitemap entry needs a special case -- and the one that forgets it
    // produces a duplicate.
    expect(localePath("tet", "/shop")).toBe("/tet/shop");
    expect(localePath("pt", "/shop")).toBe("/pt/shop");
    expect(localePath("en", "/shop")).toBe("/en/shop");
    expect(localePath("id", "/shop")).toBe("/id/shop");
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
  it("names every language plus x-default", () => {
    expect(localeAlternates("/p/sapatu")).toEqual({
      tet: "/tet/p/sapatu",
      "pt-TL": "/pt/p/sapatu",
      en: "/en/p/sapatu",
      id: "/id/p/sapatu",
      "x-default": "/tet/p/sapatu",
    });
  });

  it("uses BCP 47, which is not the cookie value", () => {
    // "pt-TL" says Portuguese as written in Timor-Leste, rather than in
    // Portugal or Brazil. "id" is the current code for Indonesian -- "in"
    // is the pre-1989 one, which browsers no longer send.
    expect(HREFLANG.pt).toBe("pt-TL");
    expect(HREFLANG.tet).toBe("tet");
    expect(HREFLANG.id).toBe("id");
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

  it("ties them all together in both directions", () => {
    // Google requires the cluster to be reciprocal: if tet names en, en
    // must name tet. Building every one of them from one function is what
    // guarantees that rather than hoping for it.
    const fromTet = localeMetadata("tet", "/p/x").alternates.languages;
    const fromEn = localeMetadata("en", "/p/x").alternates.languages;
    expect(fromTet).toEqual(fromEn);
  });
});

describe("isLocale", () => {
  it("accepts the shop's languages and nothing else", () => {
    expect(LOCALES.every(isLocale)).toBe(true);
    for (const bad of ["fr", "in", "", undefined, null, "TET", "pt-BR", "ID"]) {
      expect([bad, isLocale(bad as string)]).toEqual([bad, false]);
    }
  });
});


/* THE SWITCH IS WHERE A NEW LANGUAGE GETS HALF-ADDED.
 *
 * lib/locale.ts can know about a language, the string table can hold
 * every line of it, and the shop can still have no way to reach it --
 * because the one list that puts it in front of a shopper lives in a
 * component and nothing else reads it. That is a language that exists
 * only to a search engine. These read the component's source, which is
 * blunt, and is the only way to assert about a list that is not exported.
 */
describe("the proxy matches every locale prefix", () => {
  /* The one place a language gets added everywhere but here, and the
     symptom is not an error: /id/shop renders, in Tetun, with a Tetun
     canonical -- so the new language has a URL that serves the old one,
     which is worse than having no URL at all.

     Next reads config.matcher at build time and evaluates nothing, so it
     cannot be built from LOCALES; this is the check that stands in for
     that. */
  const PROXY = fs.readFileSync(path.join(process.cwd(), "src/proxy.ts"), "utf8");
  const matcher = /matcher: \[([\s\S]*?)\n  \]/.exec(PROXY)![1];

  it("matches the prefix and everything under it, for each one", () => {
    for (const lang of LOCALES) {
      expect(matcher, `${lang} deep`).toContain(`"/${lang}/:path*"`);
      // Separately, because "/id/:path*" does not match "/id" itself --
      // the homepage in that language.
      expect(matcher, `${lang} bare`).toMatch(new RegExp(`"/${lang}"`));
    }
  });

  it("matches nothing that is not a locale", () => {
    // A stale prefix left behind by a rename would rewrite a real path
    // into a language that no longer exists.
    const prefixes = [...matcher.matchAll(/"\/([a-z-]+)(?:\/:path\*)?"/g)]
      .map((m) => m[1])
      .filter((p) => p !== "admin" && p !== "seller");
    expect([...new Set(prefixes)].sort()).toEqual([...LOCALES].sort());
  });
});

describe("the language switch offers every language", () => {
  const SWITCH = fs.readFileSync(
    path.join(process.cwd(), "src/components/LangSwitch.tsx"), "utf8");

  it("lists them all, so none is reachable only by typing a URL", () => {
    const order = /const ORDER: Lang\[\] = \[([^\]]*)\]/.exec(SWITCH);
    expect(order, "ORDER in LangSwitch.tsx").not.toBeNull();
    const listed = [...order![1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    expect([...listed].sort()).toEqual([...LOCALES].sort());
  });

  it("names each one in itself", () => {
    // A picker that names languages in a language you do not read is a
    // picker you cannot use, so these are endonyms and are never
    // translated -- which is why they are not in the string table.
    for (const lang of LOCALES) {
      expect(SWITCH, lang).toMatch(new RegExp(`${lang}: "[^"]+"`));
    }
  });

  it("does not tell a shopper the shop has fewer languages than it does", () => {
    /* The incentive strip counts the languages out loud and then lists
       them, in each of them -- so adding one leaves four sentences saying
       "three languages: Tetum, Portuguese and English". Nothing about a
       stale count throws, and nobody reads their own header.

       Only the English line is checked by name: it is the one an author
       adding a language can read, and a line that still omits Indonesian
       there has certainly not been touched in the other three. */
    expect(STR.incLangT[2]).toBe("Four languages");
    for (const name of ["Tetum", "Portuguese", "English", "Indonesian"]) {
      expect(STR.incLangB[2], name).toContain(name);
    }
  });
});
