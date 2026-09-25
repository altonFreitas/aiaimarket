import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const CSS = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const HEADER = fs.readFileSync(path.join(root, "src/components/Header.tsx"), "utf8");
const BOTTOM = fs.readFileSync(path.join(root, "src/components/BottomNav.tsx"), "utf8");
const ICON = fs.readFileSync(path.join(root, "src/components/TrackIcon.tsx"), "utf8");

/** The body of the standalone rule for exactly this selector -- not a
 *  grouped rule that merely contains it. */
function rule(sel: string): string {
  const re = new RegExp("(?:^|\\})\\s*" + sel.replace(/\./g, "\\.") + "\\{([^}]*)\\}");
  const m = re.exec(NO_COMMENTS);
  expect(m, `the standalone ${sel} rule`).not.toBeNull();
  return m![1];
}
const px = (body: string, prop: string) =>
  Number(new RegExp(prop + ":(-?[\\d.]+)px").exec(body)?.[1] ?? NaN);

/** The code of a source file with its comments removed.
 *
 * Needed by every guard that asserts a string is ABSENT: the explanation
 * above a rule usually quotes the very thing the guard forbids, so the
 * comment satisfies the assertion and the rule can be deleted without a
 * failure. It has happened three times in this file. */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("the homepage row headings", () => {
  it("is a third bigger than it was", () => {
    /* At 19px "New Arrivals" was barely louder than the product names
       under it, so six rows of cards read as one undifferentiated column.
       25px is the 30% asked for. */
    const size = px(rule(".home-section-hd h2"), "font-size");
    expect(size).toBeGreaterThanOrEqual(24);
    expect(size).toBeLessThanOrEqual(26);
  });

  it("gives the extra height back so the cards do not move", () => {
    /* THE CONDITION ATTACHED TO THE ASK. The taller line box grows the
       heading block by 3px, so the gap under it gives 3px back: 12 -> 9.
       Measured against the previous stylesheet on the same page, the
       first card moved -1/0/-1px at 390/768/1440.

       Both bounds matter. Too much and the cards move down; too little
       and they move UP, which is the same broken promise -- 6px was tried
       and pulled them up by 4. */
    const gap = px(rule(".home-section-hd"), "margin-bottom");
    expect(gap).toBeGreaterThanOrEqual(7);
    expect(gap).toBeLessThanOrEqual(11);
  });
});

describe("buttons that look like buttons", () => {
  it("fills the secondary one instead of outlining it", () => {
    /* "Add to cart" and "Share" were transparent with a hairline round
       them, which reads as disabled -- and against the paper the page is
       made of, as nothing at all. */
    const ghost = rule(".btn-ghost");
    expect(ghost).not.toMatch(/background:transparent/);
    expect(ghost).toMatch(/background:var\(--surface-2\)/);
  });

  it("still answers the pointer once it has a fill", () => {
    /* The old hover WAS the fill, so filling it at rest without moving
       the hover would have left a button that does not respond. Both the
       surface and the edge change, so the answer survives on a white
       panel and on the paper alike. */
    const hover = rule(".btn-ghost:hover");
    expect(hover).toMatch(/background:var\(--surface-2-hi\)/);
    expect(hover).toMatch(/border-color/);
    expect(rule(".btn-ghost")).not.toMatch(/background:var\(--surface-2-hi\)/);
  });

  it("fills the destructive one too, and commits on hover", () => {
    const danger = rule(".btn-danger");
    expect(danger).not.toMatch(/background:transparent/);
    expect(danger).toMatch(/background:var\(--red-soft\)/);
    // Solid red with white on it: darkening the tint any further would
    // have taken the red text on it below 4.5:1.
    const hover = rule(".btn-danger:hover");
    expect(hover).toMatch(/background:var\(--red\)/);
    expect(hover).toMatch(/color:#fff/);
  });

  it("gives the hero's second button its own body", () => {
    /* It stands on a dark panel and overrides colour but never
       background, so the light fill above would have put white text on
       pale grey. */
    const heroGhost = /\.home \.hero-cta \.btn-ghost\{([^}]*)\}/.exec(NO_COMMENTS);
    expect(heroGhost, "the hero ghost override").not.toBeNull();
    expect(heroGhost![1]).toMatch(/background:rgba\(255,255,255/);
    expect(heroGhost![1]).toMatch(/color:#fff/);
  });
});

describe("the strip under the header", () => {
  const INC = strip(fs.readFileSync(path.join(root, "src/lib/incentives.ts"), "utf8"));
  const CMP = fs.readFileSync(path.join(root, "src/components/Incentives.tsx"), "utf8");

  it("promises nothing the settings do not support", () => {
    /* Every marquee of this kind says Free Shipping, and most of the
       shops running it have not checked whether it is true of them. Free
       appears here only where a zone's fee is genuinely zero; every other
       line hangs off the setting that makes it true. */
    expect(INC).toMatch(/Number\(best\.fee\) === 0[\s\S]{0,60}incFreeT/);
    expect(INC).toContain("if (settings.pickup)");
    expect(INC).toContain("settings.legal_return_days");
    expect(INC).toContain("if (settings.wa_number)");
  });

  it("draws nothing at all when barely anything is true", () => {
    // Two items sliding past is not a marquee, it is two items that will
    // not keep still.
    expect(CMP).toContain("if (items.length < MIN_INCENTIVES) return null;");
    expect(INC).toMatch(/MIN_INCENTIVES = [3-9]/);
  });

  it("loops by translating exactly one copy's width", () => {
    /* The list is rendered twice and the track moves -50%, so the second
       copy arrives precisely where the first began. Any other number
       shows a jump once per loop. */
    expect(NO_COMMENTS).toContain("@keyframes incScroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}");
    expect((CMP.match(/\{row\(\d\)\}/g) ?? []).length).toBe(2);
  });

  it("hides the second copy from a screen reader", () => {
    // It exists to make the loop seamless. Read aloud, it tells somebody
    // the shop delivers to Dili twice.
    expect(CMP).toContain('<div className="inc-row" aria-hidden="true">');
  });

  it("pauses under a pointer, and for a keyboard", () => {
    expect(NO_COMMENTS).toContain(".inc:hover .inc-track,\n.inc:focus-within .inc-track{animation-play-state:paused}");
  });

  it("fades at both edges rather than cutting", () => {
    /* BOTH SPELLINGS, counted. The rule carries -webkit-mask-image and
       mask-image, and a regex for "mask-image:" is satisfied by the
       prefixed one alone -- a mutation removing the real one passed. */
    const inc = /(?:^|\})\s*\.inc\{([^}]*)\}/.exec(NO_COMMENTS);
    expect(inc, "the .inc rule").not.toBeNull();
    expect((inc![1].match(/mask-image:linear-gradient\(90deg,transparent/g) ?? []).length)
      .toBe(2);
  });

  it("stops dead for anybody who asked motion to stop", () => {
    /* Something moving forever at the top of every page is exactly what
       that setting is for -- and the duplicate row goes with it, or a
       list you can now actually read is a list said twice. */
    const rm = NO_COMMENTS.slice(NO_COMMENTS.indexOf("@media(prefers-reduced-motion:reduce){\n  .inc{"));
    expect(rm, "a reduced-motion block for the strip").not.toBe("");
    expect(rm).toContain(".inc-track{animation:none}");
    expect(rm).toContain('.inc-row[aria-hidden="true"]{display:none}');
  });

  it("ships no JavaScript to do it", () => {
    // A component that only slides does not need a runtime to slide.
    expect(CMP).not.toContain('"use client"');
    expect(CMP).not.toMatch(/useState|useEffect/);
  });
});

describe("what the shop can change for itself", () => {
  const INC = strip(fs.readFileSync(path.join(root, "src/lib/incentives.ts"), "utf8"));
  const SQL = fs.readFileSync(path.join(root, "supabase/site-chrome.sql"), "utf8");
  const ACT = fs.readFileSync(path.join(root, "src/lib/actions/settings.ts"), "utf8");
  const FONT = fs.readFileSync(path.join(root, "src/lib/headingFont.ts"), "utf8");
  const ADMIN = fs.readFileSync(path.join(root, "src/components/admin/SettingsAdmin.tsx"), "utf8");
  const LAYOUT = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");

  it("lets the checklist SUBTRACT only", () => {
    /* THE WHOLE POINT. A shop must not be able to tick "free delivery"
       while its zones charge for it -- that is a promise the checkout
       then breaks, which is the bug the strip was written to avoid. The
       column stores what is switched OFF, and the filter runs after every
       line has already been earned. */
    expect(INC).toContain("settings.incentives_off");
    expect(INC).toContain(".filter((it) => !off.has(it.titleKey))");
    expect(ADMIN).toContain("disabled={!isEarned}");
  });

  it("starts by showing everything, not nothing", () => {
    /* Off rather than on, and the direction is the design: a list of what
       to SHOW would have to be filled in before anything appeared, so a
       shop that ran the migration and went to lunch would lose the strip.
       Empty means "show every line that is true", which is what it did
       the day before. */
    expect(SQL).toContain("incentives_off text[] not null default '{}'");
  });

  it("only stores keys that are real incentives", () => {
    // A stale key left behind by a rename would sit in the column for
    // ever, hiding nothing.
    expect(ACT).toContain("INCENTIVE_KEYS.has(k)");
    expect(INC).toContain("export const INCENTIVE_KEYS");
  });

  it("treats a cleared box as no override, not as an empty line", () => {
    // Leaving {title:""} in the column would print a blank where the
    // translated default belongs.
    expect(ACT).toContain("if (!title && !body) continue;");
  });

  it("refuses a face this build does not load", () => {
    /* A free-text column would let somebody type "Comic Sans" and get the
       fallback with nothing to say it had failed. The allowlist, the
       check constraint and layout.tsx all have to agree. */
    expect(FONT).toContain('export const HEADING_FONTS = ["jakarta", "inter", "grotesk", "system"]');
    expect(SQL).toContain("check (heading_font in ('jakarta', 'inter', 'grotesk', 'system'))");
    for (const v of ["--font-jakarta", "--font-inter", "--font-grotesk"]) {
      expect(LAYOUT, v).toContain(v);
    }
    // "system" needs no file; the stylesheet binds it to the system stack.
    expect(NO_COMMENTS).toContain(":root[data-face=system]{--display:var(--sans)}");
  });

  it("fetches only the face in use", () => {
    /* Without preload:false, next/font puts a <link rel=preload> on every
       page for faces nothing renders -- three fonts fetched to draw one,
       on a shop built for mobile data. */
    expect((LAYOUT.match(/preload: false/g) ?? []).length).toBe(2);
  });

  it("keeps the new columns readable by the storefront", () => {
    /* settings is read with the anon key and granted column by column. A
       column added without a grant is one the storefront asks for and is
       refused -- which fails the WHOLE select, so the shop would lose its
       name and its bank details over a font. */
    expect(SQL).toContain("grant select (heading_font) on settings to anon");
    expect(SQL).toContain("grant select (incentives_off, incentive_text)");
    const PUB = fs.readFileSync(path.join(root, "src/lib/data/public.ts"), "utf8");
    expect(PUB).toContain("heading_font, incentives_off, incentive_text");
  });

  it("bounds the wording through a function, not a subquery", () => {
    /* A CHECK constraint may not contain a subquery, and counting a jsonb
       object's keys needs one. Written inline it aborts run-all.sql at
       that line and takes every migration after it down -- exactly what
       product-highlights.sql did, and what this file did again before it
       was applied to a real database. */
    expect(SQL).toContain("create or replace function settings_incentive_text_ok");
    expect(SQL).toContain("check (settings_incentive_text_ok(incentive_text))");
  });
});

describe("what shoppers say", () => {
  const PUB = strip(fs.readFileSync(path.join(root, "src/lib/data/public.ts"), "utf8"));
  const TML = fs.readFileSync(path.join(root, "src/components/home/Testimonials.tsx"), "utf8");

  it("quotes real reviews rather than written ones", () => {
    /* Every testimonial strip on the internet is three paragraphs
       somebody made up over three stock portraits, and a shopper who
       recognises none of the names learns only that the shop will say
       anything. These are rows left by buyers against orders. */
    expect(PUB).toContain('.from("product_reviews")');
    expect(PUB).toContain('.gte("rating", 4)');
    expect(PUB).toContain('r.comment ?? ""');
  });

  it("drops a review whose product is no longer on sale", () => {
    // The link is what makes it checkable; a testimonial pointing at a
    // 404 is an opinion.
    expect(PUB).toContain('r.products.status === "approved"');
  });

  it("draws nothing until somebody has written one", () => {
    expect(TML).toContain("if (!items.length) return null;");
  });

  it("does not edit the words it quotes", () => {
    /* Trimming the text in the component would be the shop editing a
       review. It is clamped by line height instead, so a long one is cut
       visibly and the whole of it is still on the product page. */
    expect(TML).toContain("{r.comment}");
    expect(TML).not.toContain("comment.slice(");
    expect(NO_COMMENTS).toMatch(/\.tml-q\{[^}]*-webkit-line-clamp/);
  });
});

describe("the phone's menu button", () => {
  const NAV = fs.readFileSync(path.join(root, "src/components/MobileNav.tsx"), "utf8");

  it("carries the pages, not the aisles the search button already has", () => {
    /* Both buttons opened the same screen -- the aisles, the banners and
       a showcase of stock -- so two buttons gave one answer, and the shop
       noticed. */
    const pages = /const PAGES: PageRow\[\] = \[([\s\S]*?)\];/.exec(NAV)?.[1] ?? "";
    expect(pages, "the PAGES list").not.toBe("");
    expect(pages).toContain('"/about"');
    expect(pages).toContain('"/contact"');
    expect(pages).not.toContain('"/shop"');
    expect(pages).not.toContain('"/c/');
  });

  it("gives every row its own drawing", () => {
    // At this size the icon is read before the word is.
    expect(NAV).toContain("<PageIcon name={row.icon} />");
    expect(NAV).toContain('case "home":');
  });

  it("draws a row in one place, so a list cannot lose its icon alone", () => {
    /* WHY A COUNT AND NOT toContain. The two lists were written out
       twice, identically. Deleting the icon from one of them left the
       other for a guard to find, and the guard passed -- so the assertion
       is that the markup exists ONCE and both lists go through it. */
    const NAV_CODE = strip(NAV);
    expect((NAV_CODE.match(/<PageIcon name=\{row\.icon\} \/>/g) ?? []).length).toBe(1);
    expect((NAV_CODE.match(/className="mpage"/g) ?? []).length).toBe(1);
    expect((NAV_CODE.match(/<PageLink key=\{row\.href\}/g) ?? []).length).toBe(2);
  });

  it("marks the page you are already on, and stops offering it", () => {
    const NAV_CODE = strip(NAV);
    expect(NAV_CODE).toContain('aria-current={here ? "page" : undefined}');
    // Once, because the row is drawn once -- and every list passes it.
    expect((NAV_CODE.match(/aria-current=/g) ?? []).length).toBe(1);
    expect((NAV_CODE.match(/here=\{pathname === row\.href\}/g) ?? []).length).toBe(2);
    expect(NO_COMMENTS).toContain(".mpage[aria-current=page] .mpage-arw{display:none}");
  });

  it("keeps the aisles on the search screen, where somebody typing wants them", () => {
    const search = NAV.slice(NAV.indexOf('{view === "search" && createPortal('));
    expect(search).toContain('t("categories", lang)');
  });
});

describe("the heading face", () => {
  const LAYOUT = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");

  it("is self-hosted by next/font, not fetched from Google at run time", () => {
    /* No third-party request, no extra DNS round trip, and nothing for
       the cookie notice to have to mention. */
    expect(LAYOUT).toContain('from "next/font/google"');
    /* It was one face bound to --font-display. There are three now, each
       with its own variable, because the shop picks between them -- so
       the assertion is that every one of them declares a variable rather
       than that a particular name exists. */
    expect((LAYOUT.match(/variable: "--font-/g) ?? []).length).toBe(3);
    expect((LAYOUT.match(/display: "swap"/g) ?? []).length).toBe(3);
    expect(NO_COMMENTS).not.toMatch(/fonts\.googleapis/);
  });

  it("dresses the headings and leaves the body alone", () => {
    /* This shop is built for mobile data in Timor-Leste. One file, spent
       where it shows; body text stays on the face the reader's own phone
       renders best, which costs nothing at all. */
    expect(NO_COMMENTS).toMatch(/h1,h2,h3[^{]*\{font-family:var\(--display\)\}/);
    /* THE BODY RULE ITSELF, not "somewhere near a body{". The looser
       version passed with the body switched to the display face, because
       the stylesheet has more than one rule beginning "body{" and the
       window reached a var(--sans) belonging to another one. */
    const body = /(?:^|\})\s*body\{([^}]*font-family[^}]*)\}/.exec(NO_COMMENTS);
    expect(body, "the body rule that sets a font").not.toBeNull();
    expect(body![1]).toContain("font-family:var(--sans)");
    expect(body![1]).not.toContain("var(--display)");
  });

  it("falls back to the system stack while the file is in flight", () => {
    // A heading invisible for 300ms on a slow connection is worse than a
    // heading in Helvetica.
    /* The default binding, and the three the picker switches to. Every
       one of them keeps the system stack behind it. */
    expect(NO_COMMENTS).toMatch(/--display:var\(--font-jakarta\),-apple-system/);
    expect(NO_COMMENTS).toMatch(/\[data-face=inter\]\{--display:var\(--font-inter\),-apple-system/);
    expect(NO_COMMENTS).toMatch(/\[data-face=grotesk\]\{--display:var\(--font-grotesk\),-apple-system/);
  });
});

describe("which nav item says you are here", () => {
  const NAV = fs.readFileSync(path.join(root, "src/components/HeaderNav.tsx"), "utf8");

  it("compares a path segment, not a string prefix", () => {
    /* THE BUG, reported from the live shop: opening /contact lit
       Categories as well. Categories marks itself for the category pages,
       which live under /c/, and startsWith("/c") is true of "/contact" --
       and of /checkout, and of any route beginning with c this shop ever
       adds. */
    expect(NAV).not.toMatch(/pathname\.startsWith\(href\)/);
    expect(NAV).toContain('pathname.startsWith(href + "/")');
  });

  it("does not light the home link on every page", () => {
    // "/" is a prefix of everything.
    expect(NAV).toContain('if (href === "/") return false;');
  });

  it("marks the page you are on in the admin header's ink, not in amber", () => {
    /* Amber is this shop's call-to-action colour -- Search, Shop now, Add
       to cart -- and on a nav item it read as a fourth button in a row of
       links. */
    const rule = /\.hd-nav-a\.is-here::after\{([^}]*)\}/.exec(NO_COMMENTS);
    expect(rule, "the active-item rule").not.toBeNull();
    expect(rule![1]).toContain("background:var(--ink-2)");
    expect(rule![1]).not.toContain("var(--amber)");
  });
});

describe("the paper the shop is printed on", () => {
  it("is the near-white the shop asked for", () => {
    /* #f8fafc. It was #eceff3, chosen to sit under a woven background
       that is no longer there, and next to white cards on plain ground it
       read as grey. */
    expect(NO_COMMENTS).toMatch(/--paper:#f8fafc/);
  });

  it("keeps a map link's underline in the stylesheet, not inline on the component", () => {
    /* An inline style is the one thing a stylesheet cannot answer, so a
       caller that wanted the pin without the rule -- a fact card whose
       whole surface is already the link -- had no way to ask. */
    /* THE CODE, NOT THE FILE. The note left in that component quotes the
       inline style it replaced, to explain why it is gone -- so searching
       the whole file for it fails on the explanation of its own absence.
       Third time this repo has hit that; read past the comments. */
    const map = strip(fs.readFileSync(path.join(root, "src/components/MapLink.tsx"), "utf8"));
    expect(map).not.toMatch(/textDecoration:\s*"underline"/);
    expect(map).toContain('className="maplink"');
    expect(NO_COMMENTS).toMatch(/\.maplink\{[^}]*text-decoration:underline/);
  });
});

describe("the hero runs edge to edge", () => {
  /* IT WAS BOXED IN ONCE, and the shop asked for it back. The reasoning
     for boxing it was that everything else on plain paper is a
     soft-shadowed card and a full-width slab was the odd one out. That
     is a real observation and it is still the wrong trade: the hero is
     the one element on the homepage allowed to ignore the content width,
     and an inset card cuts the picture off at both sides.
     This is here so the same tidy-minded change cannot be made twice. */
  it("is not constrained to the content width", () => {
    const hero = /(?:^|\})\s*\.home \.hero\{([^}]*)\}/.exec(NO_COMMENTS);
    expect(hero, "the .home .hero rule").not.toBeNull();
    expect(hero![1], "no max-width on the hero").not.toMatch(/max-width/);
    expect(hero![1], "no border-radius on the hero").not.toMatch(/border-radius/);
    expect(hero![1], "no margin centring the hero").not.toMatch(/margin:/);
  });

  it("still lines its headline up with the rows below it", () => {
    /* --bleed-pad is the gutter the element would have had inside .wrap.
       Full bleed without it puts the headline against the window edge. */
    expect(NO_COMMENTS).toMatch(/\.home \.hero\{[^}]*padding:26px var\(--bleed-pad\)/);
    expect(NO_COMMENTS).toMatch(/\.home \.hero\{[^}]*padding:52px var\(--bleed-pad\)/);
  });

  it("keeps the photograph hero full width too", () => {
    const car = /(?:^|\})\s*\.hero-carousel\{([^}]*)\}/.exec(NO_COMMENTS);
    expect(car, "the .hero-carousel rule").not.toBeNull();
    expect(car![1]).not.toMatch(/max-width/);
  });
});

describe("the cloth behind the page", () => {
  /* IT IS GONE, at the shop's request, and this guards the removal the
     way the test above it used to guard the opacity.
     A Timor-Leste tais was the ground the whole store rested on, faded
     down twice before it was taken out. It cost more than it looked:
     every card, panel and strip carried a hard 1px border whose real job
     was to separate white from the weave, and the reference the shop
     designed to is plain paper. The asset itself stays in public/ -- it
     is the shop's own cloth, and deleting it would make putting it back
     a re-draw rather than a rule. */
  it("no longer paints a layer behind the page", () => {
    expect(NO_COMMENTS).not.toMatch(/body::before/);
    expect(NO_COMMENTS).not.toMatch(/tais\.svg/);
    expect(NO_COMMENTS).not.toMatch(/--tais-opacity/);
  });

  it("still paints the paper colour on <html>, not only on <body>", () => {
    /* That is what fills the over-scroll area on iOS. A body-only
       background leaves a white band there when the page bounces, which
       is exactly the sort of thing removing a full-page layer breaks. */
    expect(NO_COMMENTS).toMatch(/html\{background:var\(--paper\)\}/);
  });
});

describe("the way to order tracking", () => {
  it("is a parcel, not the search icon", () => {
    /* The magnifying glass is the SEARCH icon and sits a few elements away
       in the same chrome, so "where is my order" was dressed as "find a
       product". A parcel: the box outline plus the two strokes of its open
       top, which is what makes it read as one at 16px. */
    expect(ICON).not.toMatch(/<circle cx="11" cy="11" r="7"/);
    expect(ICON.match(/<path/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(ICON).toMatch(/aria-hidden="true"/);
  });

  it("is the same drawing on a phone as on a laptop", () => {
    /* THE BUG THIS FIXES. These were two copies of an inline <svg>, and
       they drifted: the header got the parcel and the phone's bottom bar
       was left holding the magnifying glass, so the same errand wore two
       faces depending on the device -- and on the phone it wore SEARCH's,
       which is a separate button two tabs away. A component cannot
       drift. */
    for (const [name, src] of [["Header", HEADER], ["BottomNav", BOTTOM]] as const) {
      expect(src, name).toMatch(/<TrackIcon/);
      expect(src, name).toMatch(/import TrackIcon from ".\/TrackIcon"/);
      expect(src, name).not.toMatch(/<circle cx="11" cy="11" r="7"/);
    }
  });

  it("still says what it is in words, in both places", () => {
    // An unlabelled glyph is a guessing game, and on a desktop this is the
    // only route to tracking at all.
    const link = /<Link className="icon-btn hd-track"[\s\S]*?<\/Link>/.exec(HEADER);
    expect(link, "the header track link").not.toBeNull();
    expect(link![0]).toMatch(/\{t\("navTrack", lang\)\}/);
    expect(BOTTOM).toMatch(/\{t\("navTrack", lang\)\}/);
  });
});

describe("the section headings", () => {
  it("are set in title case", () => {
    /* THEY WERE CAPITALS, and this test asserted that. The shop asked
       for capitals once and has since asked for them back in title case
       to match the reference design. Both are legitimate and neither is
       a bug, so the guard follows the shop rather than freezing the
       older answer -- what it protects is the MECHANISM below, which is
       the part that would actually break something. */
    const h2 = /(?:^|\})\s*h2\{([^}]*)\}/.exec(NO_COMMENTS);
    expect(h2, "the h2 rule").not.toBeNull();
    expect(h2![1]).not.toMatch(/text-transform:uppercase/);
  });

  it("is decided in CSS, not by retyping the words", () => {
    /* The words in the DOM never changed while the case did, and that is
       the thing worth protecting: a screen reader says "New Arrivals"
       rather than spelling out an acronym, the page title and the search
       index keep real words, and a translator receives a normal
       sentence. Shouting in the stylesheet is reversible; shouting in the
       string table is not. */
    const i18n = fs.readFileSync(path.join(root, "src/lib/i18n.ts"), "utf8");
    expect(i18n).toMatch(/newArrivals:\[/);
    expect(i18n).not.toMatch(/newArrivals:\["[^"]*NEW ARRIVALS/);
  });

  it("gives the display face the tracking it needs", () => {
    /* THIS TEST HAS BEEN RIGHT TWICE, in opposite directions, and both
       times for the same reason: tracking follows the case and the face.
       It asked for POSITIVE tracking while these were capitals, where a
       negative value closes them into a block. They are title case now
       and set in Plus Jakarta Sans, which draws wider than the system
       stack at the same size -- so left alone a headline reads as a row
       of letters rather than as a word, and it wants pulling in.
       Both the base rule and the homepage rows, which set their own. */
    const h2 = /(?:^|\})\s*h2\{([^}]*)\}/.exec(NO_COMMENTS)![1];
    expect(Number(/letter-spacing:(-?[\d.]+)em/.exec(h2)?.[1] ?? 1)).toBeLessThan(0);
    const row = rule(".home-section-hd h2");
    expect(Number(/letter-spacing:(-?[\d.]+)em/.exec(row)?.[1] ?? 1)).toBeLessThan(0);
  });
});
