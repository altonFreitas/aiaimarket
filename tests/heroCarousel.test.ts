import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { heroFeature } from "@/lib/heroFeature";
import type { Category, HeroSlide, Product } from "@/lib/types";

/* THE FULL-BLEED HERO, AND THE CARD ON IT.
 *
 * The hero was a band -- 4/5 on a phone, 720px on a desktop -- with a
 * headline over it. It is now the whole viewport below the chrome, and a
 * slide can name a PRODUCT, which draws the shop's real card for it.
 *
 * The thing these guards exist to prevent is the obvious shortcut: typing
 * a name, a price and "5.8K REVIEWS" into the slide, the way the
 * reference mock-up shows them. The slide stores WHICH product; every
 * figure is read from that product, so the homepage cannot advertise $69
 * for something the catalogue sells at $75, or five stars for something
 * nobody has reviewed.
 */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const HERO = code("src/components/home/Hero.tsx");
const CARD = code("src/components/home/HeroProductCard.tsx");
const ADMIN = code("src/components/admin/HeroSlidesAdmin.tsx");
const ACTION = code("src/lib/actions/hero.ts");
const CSS = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const I18N = read("src/lib/i18n.ts");

/** The rail's OWN declaration, not one of the width overrides that also
 * open with `.hero-rail{`. Matching the first occurrence found the
 * narrow-screen `bottom:` override, which says nothing about how the
 * strip is laid out. */
function railBase(): string | null {
  for (const m of CSS.matchAll(/\.hero-rail\{([^}]*)\}/g)) {
    if (m[1].includes("position:absolute")) return m[1];
  }
  return null;
}
const SQL = read("supabase/hero-product.sql")
  .replace(/^\s*--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const prod = (o: Partial<Product> = {}): Product => ({
  id: "p1", seller_id: "s", ref: "R", name: "Mist", slug: "mist", category_id: "c1",
  price: 69, discount_price: null, stock_status: "in", qty: 5, description: "",
  images: [], sizes: [], tags: [], archived: false, status: "approved",
  views: 0, wa_clicks: 0, created_at: "", ...o,
} as Product);
const slide = (o: Partial<HeroSlide> = {}): HeroSlide => ({
  id: "s1", image_url: "", headline: "", subtext: "", cta_label: "", cta_href: "",
  sort_order: 0, created_at: "", ...o,
} as HeroSlide);
const cats = [{ id: "c1", name: "Face Mist" }] as Category[];

describe("which product a slide features", () => {
  it("resolves the product the slide names", () => {
    const f = heroFeature(slide({ product_id: "p1" }), [prod()], cats);
    expect(f?.product.name).toBe("Mist");
    expect(f?.categoryName).toBe("Face Mist");
  });

  it("draws no card for a slide that names none", () => {
    for (const id of [null, undefined, "", "   "]) {
      expect([id, heroFeature(slide({ product_id: id }), [prod()], cats)]).toEqual([id, null]);
    }
  });

  it("draws no card for a product the shop is not selling", () => {
    /* The list it resolves against is getLiveProducts -- approved and not
       archived. A hero advertising something nobody can buy is worse than
       a hero with no card on it. */
    expect(heroFeature(slide({ product_id: "gone" }), [prod()], cats)).toBeNull();
    expect(heroFeature(slide({ product_id: "p1" }), [], cats)).toBeNull();
  });

  it("omits the category line rather than printing an empty one", () => {
    expect(heroFeature(slide({ product_id: "p1" }), [prod({ category_id: null })], cats)
      ?.categoryName).toBe("");
    expect(heroFeature(slide({ product_id: "p1" }), [prod()], [])?.categoryName).toBe("");
  });

  it("is resolved from the catalogue the page already loaded", () => {
    // Not a query of its own: the homepage has these products in hand.
    expect(HERO).toMatch(/heroFeature\(active, products, cats\)/);
  });
});

describe("what the card may claim", () => {
  it("reads every figure off the product, never off the slide", () => {
    for (const field of ["price", "rating", "name"]) {
      expect([field, new RegExp(`slide\\.${field}|active\\.${field}`).test(CARD)])
        .toEqual([field, false]);
    }
    expect(CARD).toMatch(/ratingAverage\(p\)/);
    expect(CARD).toMatch(/money\(Number\(p\.price\)\)/);
  });

  it("says nothing at all about a product nobody has reviewed", () => {
    /* ratingAverage returns null there, and the reference's five filled
       stars beside a review count would be a verdict this shop has not
       earned. Not zero stars, not "0 reviews" -- nothing. */
    expect(CARD).toMatch(/\{rating != null && \(/);
  });

  it("invents no review count", () => {
    expect(CARD).not.toMatch(/5\.8K|\bK REVIEWS\b/i);
    expect(CARD).toMatch(/Number\(p\.rating_count\)/);
  });

  it("does not print '1 reviews'", () => {
    expect(CARD).toMatch(/reviews === 1 \? "heroReview1" : "heroReviews"/);
  });

  it("charges the discount when one is running", () => {
    expect(CARD).toMatch(/p\.discount_price \?/);
    expect(CARD).toMatch(/discountPercent\(p\.price, p\.discount_price\)/);
  });

  it("shows the same stock badge the grid cards show", () => {
    // Different layout, same three verdicts -- a product "In stock" on the
    // hero and "Out of stock" in the grid is one shop disagreeing itself.
    const grid = code("src/components/ProductCard.tsx");
    const keys = (src: string) =>
      (/const BADGE = \{([^}]*)\}/.exec(src)?.[1] || "").replace(/\s/g, "");
    expect(keys(CARD)).toBe(keys(grid));
    expect(keys(CARD)).not.toBe("");
  });

  it("offers a gallery only where there is more than one photo", () => {
    // One dot under one photo is a control that does nothing.
    expect(CARD).toMatch(/gallery\.length > 1 && \(/);
  });

  it("makes the gallery buttons, not hover -- a phone has no hover", () => {
    // The substance, not the attribute order: the shot control is a real
    // button with a click handler, and nothing reveals it on hover alone.
    const shot = /<button[^>]*className=\{"hpc-shot"[\s\S]*?\/>/.exec(CARD);
    expect(shot, "the gallery control").not.toBeNull();
    expect(shot![0]).toMatch(/type="button"/);
    expect(shot![0]).toMatch(/onClick=/);
    expect(shot![0]).toMatch(/aria-label=/);
    expect(CSS).not.toMatch(/:hover[^{}]*\.hpc-shot/);
  });

  it("keeps the wishlist heart from following the card's link", () => {
    /* The handler's OWN body: a bare search for preventDefault passed
       with the heart's removed, because the gallery button has one too. */
    const fn = /function toggleLove\([\s\S]*?\n  \}/.exec(CARD);
    expect(fn, "the heart's click handler").not.toBeNull();
    expect(fn![0]).toMatch(/e\.preventDefault\(\)/);
    expect(fn![0]).toMatch(/e\.stopPropagation\(\)/);
  });
});

describe("the frame", () => {
  it("fills the viewport under whatever is drawn above it", () => {
    /* CSS cannot know how much chrome sits above the hero -- the sticky
       header is only part of it -- so the height is measured. The calc is
       the fallback for the paint before that runs. */
    expect(CSS).toMatch(/\.hero-carousel\{[^}]*height:var\(--hero-fit,calc\(100svh - var\(--chrome-h\)\)\)/);
    expect(HERO).toMatch(/setProperty\("--hero-fit"/);
    expect(HERO).toMatch(/window\.innerHeight - top/);
  });

  it("uses svh, not vh, so a phone's address bar does not overshoot it", () => {
    const rules = [...CSS.matchAll(/\.hero-carousel\{([^}]*)\}/g)].map((m) => m[1]);
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r).not.toMatch(/100vh/);
  });

  it("never collapses, whatever the measurement says", () => {
    for (const r of [...CSS.matchAll(/\.hero-carousel\{([^}]*)\}/g)].map((m) => m[1])) {
      expect(r).toMatch(/min-height:\d+px/);
    }
  });

  it("re-measures when the strip above it reflows", () => {
    /* Constructed and pointed at something, not merely mentioned -- a
       stub cast to ResizeObserver satisfied a bare name match. */
    expect(HERO).toMatch(/new ResizeObserver\(fit\)/);
    expect(HERO).toMatch(/ro\.observe\(/);
    expect(HERO).toMatch(/ro\.disconnect\(\)/);
    expect(HERO).toMatch(/addEventListener\("resize"/);
    expect(HERO).toMatch(/removeEventListener\("resize"/);
  });
});

describe("the picture in the frame", () => {
  it("still lets a slide choose to be shown WHOLE", () => {
    /* THE ANTI-REGRESSION GUARD. A taller frame is not what stops a
       portrait video being cropped -- measured in a browser, "cover" keeps
       32% of a 9:16 source in a 1280x723 frame, and "contain" keeps all of
       it. The per-slide choice is the fix; the full-bleed frame only makes
       the whole picture bigger. Removing it would undo the fix this hero
       already carries. */
    expect(HERO).toMatch(/function fitOf/);
    expect(HERO).toMatch(/s\.media_fit === "cover" \? "cover" : "contain"/);
    expect(CSS).toMatch(/\.hero-slide-img\.is-contain\{object-fit:contain\}/);
  });

  it("keeps the blurred fill behind a contained picture", () => {
    // Flat bars read as a page that failed to load something.
    expect(CSS).toMatch(/\.hero-slide-fill\{[^}]*filter:blur/);
  });

  it("renders no <img> at all when a slide has no picture", () => {
    /* src="" is not "draw nothing": the browser resolves it against the
       current document and re-requests the whole page. A slide with no
       picture is a real state -- a video with no poster, or a card over
       the dark ground. */
    expect(HERO).toMatch(/videoSrc\(s\) \|\| !s\.image_url \? null/);
  });
});

describe("choosing the product in /admin/hero", () => {
  it("offers the picker only once the database has the column", () => {
    // A control that takes a choice, says "saved" and changes nothing is
    // worse than one that is not there.
    expect(ADMIN).toMatch(/\{s\.product_id !== undefined && \(/);
  });

  it("offers a way back to no product at all", () => {
    expect(ADMIN).toMatch(/<option value="">\{t\("slideNoProduct", lang\)\}<\/option>/);
  });

  it("saves an empty choice as NULL, not as an empty string", () => {
    // "" is not a uuid; Postgres rejects the whole update over it.
    expect(ACTION).toMatch(/optional\.product_id = \(product_id \|\| null\)/);
  });

  it("still saves the rest on a database without the column", () => {
    expect(ACTION).toMatch(/writeTolerating\(\s*\n?\s*optional,/);
    expect(ACTION).toMatch(/if \(media_fit !== undefined\) optional\.media_fit = media_fit/);
  });
});

describe("the column itself", () => {
  it("references the product rather than copying it", () => {
    expect(SQL).toMatch(/product_id uuid references products\(id\)/);
  });

  it("keeps the slide when the product is deleted", () => {
    // The picture, the headline and the CTA are the owner's work.
    expect(SQL).toMatch(/on delete set null/);
    expect(SQL).not.toMatch(/on delete cascade/);
  });

  it("is readable by the storefront", () => {
    // A new column is invisible to the anon key until it is granted,
    // which looks exactly like the column not existing.
    expect(SQL).toMatch(/grant select \(product_id\) on hero_slides to anon/);
  });

  it("re-runs safely", () => {
    expect(SQL).toMatch(/add column if not exists product_id/);
    expect(SQL).toMatch(/create index if not exists/);
  });

  it("is registered so run-all.sql includes it", () => {
    const health = read("src/lib/schemaHealth.ts");
    /* SCHEMA_ORDER is what run-all.sql is GENERATED from, so that is what
       has to name the file. Checking only the generated output passed
       with the entry deleted -- run-all.sql had simply not been
       regenerated yet -- and checking the whole health file passed on the
       SCHEMA_FEATURES entry alone. */
    const order = health.slice(health.indexOf("export const SCHEMA_ORDER"));
    expect(order.slice(0, order.indexOf("];"))).toContain('"hero-product.sql"');
    expect(health).toMatch(/columns: \[\["hero_slides", "product_id"\]\]/);
    expect(read("supabase/run-all.sql")).toContain("hero-product.sql");
  });
});

describe("the slide rail", () => {
  it("shows what is coming next, in the order it will arrive", () => {
    /* Dots say how many slides there are and which one you are on. They
       cannot say what is ON any of them, so the only way to find the
       slide you half-remember is to wait for it to come round. */
    expect(HERO).toMatch(/const idx = \(i \+ 1 \+ n\) % slides\.length/);
    expect(HERO).toMatch(/className="hero-rail"/);
  });

  it("gives a pictureless slide a square anyway", () => {
    // A gap would misalign the strip with the slides it stands for.
    expect(HERO).toMatch(/hero-rail-blank/);
  });

  it("rings every square, which is what makes it read as a thumbnail", () => {
    const rule = /\.hero-rail-item\{([^}]*)\}/.exec(CSS);
    expect(rule, "the rail item").not.toBeNull();
    expect(rule![1]).toMatch(/border:\dpx solid/);
    expect(rule![1]).toMatch(/aspect|width:\d+px;height:\d+px/);
  });

  it("is there at every width, because it is now the only way round", () => {
    /* It was desktop-only while the prev/next arrows existed. Removing
       them there and leaving this hidden would have left a phone with
       nothing but 7px dots -- which is the thing this codebase already
       decided is a target you can see and cannot hit. */
    expect(CSS).not.toMatch(/\.hero-rail\{[^}]*display:none/);
    const base = railBase();
    expect(base, "the rail's own declaration").not.toBeNull();
    expect(base!).toMatch(/display:flex/);
  });

  it("is a row along the bottom on a phone and a column beside the card on a desktop", () => {
    const base = railBase()!;
    // Base: full width, centred, horizontal.
    expect(base).toMatch(/left:\d+px/);
    expect(base).toMatch(/right:\d+px/);
    expect(base).not.toMatch(/flex-direction:column/);
    const wide = /@media \(min-width:900px\)\{\s*\.hero-rail\{([^}]*)\}/.exec(CSS);
    expect(wide, "the wide-screen rail").not.toBeNull();
    expect(wide![1]).toMatch(/flex-direction:column/);
    expect(wide![1]).toMatch(/left:auto/);
  });

  it("leaves the slide's own copy room above it", () => {
    /* MEASURED: at 46px of bottom padding the rail's 60px row sat on top
       of the headline and the CTA -- a control over the thing it is meant
       to sit under. */
    const inner = /\.hero-slide-inner\{([^}]*)\}/.exec(CSS);
    expect(inner, "the overlay's inner stack").not.toBeNull();
    expect(inner![1]).toMatch(/padding:0 0 calc\(var\(--bn-h\) \+ \d+px\)/);
  });
});

describe("the carousel's controls", () => {
  it("has no play or pause button", () => {
    expect(HERO).not.toMatch(/heroPlay|heroPause|PlayIcon|PauseIcon/);
  });

  it("holds still while somebody is looking at a slide instead", () => {
    /* What replaced it. Advancing is most annoying exactly when somebody
       has stopped to read, and focus counts as looking -- a keyboard user
       tabbing into a slide's link must not have it slide away. */
    expect(HERO).toMatch(/onMouseEnter=\{\(\) => setPaused\(true\)\}/);
    expect(HERO).toMatch(/onMouseLeave=\{\(\) => setPaused\(false\)\}/);
    expect(HERO).toMatch(/onFocusCapture=\{\(\) => setPaused\(true\)\}/);
    expect(HERO).toMatch(/onBlurCapture=\{\(\) => setPaused\(false\)\}/);
  });

  it("keeps the mute control, which answers a different question", () => {
    // A video that starts making noise is not the same problem as one
    // that moves.
    expect(HERO).toMatch(/heroUnmute|heroMute/);
  });

  it("has no prev/next arrows at all", () => {
    /* Removed on request: a square you can SEE is a better way back than
       an arrow that steps blindly, and two controls doing one job is one
       more than the frame has room for. */
    expect(HERO).not.toMatch(/hero-arrow/);
    expect(HERO).not.toMatch(/heroPrevSlide|heroNextSlide/);
    expect(CSS).not.toMatch(/\.hero-arrow/);
    // ...and their wording is not left behind in the dictionary.
    expect(I18N).not.toMatch(/heroPrevSlide|heroNextSlide/);
  });

  it("clears the phone's bottom bar", () => {
    /* MEASURED: the dots sat at y=821 inside a fixed bar occupying
       792-844. On screen, and not pressable. The rail sits above them and
       has to clear it too. */
    const phone = /@media \(max-width:899px\)\{([\s\S]*?)\n\}/.exec(CSS);
    expect(phone, "the narrow-screen hero rules").not.toBeNull();
    expect(phone![1]).toMatch(/\.hero-dots\{bottom:calc\(var\(--bn-h\)/);
    expect(phone![1]).toMatch(/\.hero-rail\{bottom:calc\(var\(--bn-h\)/);
    expect(CSS).toMatch(/--bn-h:\d+px/);
  });

  it("leaves the overlay room for the rail, and nothing on the left", () => {
    /* The right padding clears the rail's column. The left had been
       clearing the prev arrow; with that gone the card goes back to the
       page's own gutter rather than sitting 74px inside it. */
    const wide = /\.hero-slide-overlay\{align-items:center;([\s\S]{0,120}?)\}/.exec(CSS);
    expect(wide, "the wide-screen overlay rule").not.toBeNull();
    expect(wide![1]).toMatch(/padding-right:\d+px/);
    expect(wide![1]).not.toMatch(/padding-left/);
  });
});

describe("the card's gallery", () => {
  it("has arrows, not only dots", () => {
    // A 7px dot is a thing you can see and cannot hit.
    expect(CARD).toMatch(/hpc-arrow-prev/);
    expect(CARD).toMatch(/hpc-arrow-next/);
    expect(CARD).toMatch(/heroShotPrev/);
    expect(CARD).toMatch(/heroShotNext/);
  });

  it("wraps at both ends", () => {
    // An arrow that stops working is one somebody presses twice before
    // believing it.
    expect(CARD).toMatch(/\(i \+ by \+ gallery\.length\) % gallery\.length/);
  });

  it("caps the photos once, so the dots and the arrows agree", () => {
    /* The dots sliced to five while the arrows would have walked the
       whole array: press next six times and the photo changes with no dot
       to match it. */
    const cap = /const SHOTS = (\d+)/.exec(CARD);
    expect(cap, "the photo cap").not.toBeNull();
    /* Small enough to be a cap. Both the dots and the arrows honour
       whatever this says, so a large number is not incorrect -- it is a
       row of dots nobody can count, which is what the cap was for. */
    expect(Number(cap![1])).toBeGreaterThan(1);
    expect(Number(cap![1])).toBeLessThanOrEqual(8);
    expect(CARD).toMatch(/\.slice\(0, SHOTS\)/);
    expect(CARD).not.toMatch(/\.slice\(0, 5\)/);
  });

  it("zooms the photo, not the card", () => {
    /* Scaling the card would drag the price and the rating with it and
       shift everything around it. */
    expect(CSS).toMatch(/\.hpc:hover \.hpc-ph img\{transform:scale\([\d.]+\)\}/);
    expect(CSS).toMatch(/\.hpc-ph\{[^}]*overflow:hidden/);
    expect(CSS).not.toMatch(/\.hpc:hover\{[^}]*transform:scale/);
  });

  it("does not zoom where there is no pointer, or where motion is unwanted", () => {
    expect(CSS).toMatch(/@media \(hover:hover\)\{\s*\.hpc:hover \.hpc-ph img/);
    expect(CSS).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[\s\S]{0,160}\.hpc:hover \.hpc-ph img\{transform:none\}/);
  });
});

describe("how much of a phone the hero's card takes", () => {
  /* REPORTED FROM A PHONE: the card was most of the slide. At 72vw it was
     281px of a 390px screen and, with its body under it, 370px of a 659px
     hero -- so the headline and the CTA it is meant to sit beside were
     squeezed into what was left. It is a card ON the slide, not the
     slide. */

  it("is a little over half the width, not three quarters", () => {
    const rule = /\.hero-slide-card\{[^}]*width:min\((\d+)px,(\d+)vw\)/.exec(CSS);
    expect(rule, "the phone card width").not.toBeNull();
    const [, px, vw] = rule!;
    expect(Number(vw)).toBeLessThanOrEqual(60);
    expect(Number(px)).toBeLessThanOrEqual(240);
    // ...and still big enough to be a card rather than a thumbnail.
    expect(Number(px)).toBeGreaterThanOrEqual(180);
  });

  it("leaves the desktop card alone", () => {
    // Only the phone was complained about, and 320px beside the copy is
    // a quarter of a 1280 screen.
    const wide = /@media \(min-width:900px\)\{[\s\S]*?\.hero-slide-card\{width:(\d+)px/.exec(CSS);
    expect(wide, "the wide-screen card").not.toBeNull();
    expect(Number(wide![1])).toBeGreaterThanOrEqual(300);
  });

  it("keeps the name and the price on one row at that width", () => {
    /* A product name is one long word as often as not --
       BAUCANIAPRODUTO -- and at the narrower card the browser broke it
       mid-word and pushed the price onto a second row. */
    const rule = /\.hpc-name\{([^}]*)\}/.exec(CSS);
    expect(rule, "the card's name").not.toBeNull();
    expect(rule![1]).toMatch(/white-space:nowrap/);
    expect(rule![1]).toMatch(/text-overflow:ellipsis/);
    expect(rule![1]).toMatch(/overflow:hidden/);
    // min-width:0 is what lets it shrink inside the flex row at all.
    expect(rule![1]).toMatch(/min-width:0/);
  });
});
