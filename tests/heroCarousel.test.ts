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
