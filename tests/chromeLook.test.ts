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
    const map = fs.readFileSync(path.join(root, "src/components/MapLink.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
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

  it("gives capitals the tracking they need", () => {
    /* The negative letter-spacing these carried was chosen for mixed case;
       on capitals it closes them into a block. Both the base rule and the
       homepage rows, which set their own. */
    const h2 = /(?:^|\})\s*h2\{([^}]*)\}/.exec(NO_COMMENTS)![1];
    expect(Number(/letter-spacing:(-?[\d.]+)em/.exec(h2)?.[1] ?? -1)).toBeGreaterThan(0);
    const row = rule(".home-section-hd h2");
    expect(Number(/letter-spacing:(-?[\d.]+)em/.exec(row)?.[1] ?? -1)).toBeGreaterThan(0);
  });
});
