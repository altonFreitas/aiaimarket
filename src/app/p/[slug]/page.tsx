import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import ProductInteractive from "@/components/ProductInteractive";
import { oneSizeStock } from "@/lib/data/sizeStock";
import { sizePricesOf } from "@/lib/data/sizePrices";
import ProductGallery from "@/components/ProductGallery";
import ProductActions from "@/components/ProductActions";
import ProductCard from "@/components/ProductCard";
import ProductReviews from "@/components/ProductReviews";
import { getCategories, getProductBySlug, getProductReviews, getRelatedProducts, getSettings, bumpView, getApprovedSellersById } from "@/lib/data/public";
import { productSpecs } from "@/lib/data/productSpecs";
import SpecValue from "@/components/SpecValue";
import { ratingAverage } from "@/lib/utils";
import { getLang } from "@/lib/lang";
import { localeMetadata, localePath } from "@/lib/locale";
import { breadcrumbLd, serializeJsonLd } from "@/lib/jsonLd";
import { t } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await getProductBySlug(slug);
  if (!p) return { title: "404" };
  const description = p.description?.slice(0, 150);
  const images = p.images?.length ? [p.images[0]] : [];
  // Three URLs, one per language, each canonical to itself and tied to the
  // other two by hreflang. See lib/locale.ts.
  const lang = await getLang();
  const path = `/p/${p.slug}`;
  return {
    title: p.name,
    description,
    ...localeMetadata(lang, path),
    openGraph: { type: "website", url: localePath(lang, path), title: p.name, description, images },
    twitter: { card: "summary_large_image", title: p.name, description, images },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [lang, settings, p, cats, sellersById] = await Promise.all([
    getLang(), getSettings(), getProductBySlug(slug), getCategories(), getApprovedSellersById(),
  ]);
  if (!p) notFound();
  const seller = sellersById[p.seller_id] || null;

  // E4 view counter — fire and forget, never blocks the render
  void bumpView(p.id).catch(() => {});

  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  const proto = h.get("x-forwarded-proto") || "https";
  const siteOrigin = host ? `${proto}://${host}` : "";

  const cat = cats.find((c) => c.id === p.category_id);
  const parent = cat?.parent_id ? cats.find((c) => c.id === cat.parent_id) : null;
  const trail = [parent, cat].filter(Boolean) as typeof cats;

  const [related, reviews, specs, sizePrices] = await Promise.all([
    getRelatedProducts(p.category_id, p.id), getProductReviews(p.id),
    // Only what this product actually answers -- see lib/data/productSpecs.
    productSpecs(p.id),
    /* What each size sells for, when the purchase order set them
       separately. Empty for a product bought at one price and for a
       fridge, and then the page quotes the product's own price for
       everything, exactly as it always did. */
    sizePricesOf(p.id),
  ]);

  /* THE SIZES THIS IS ACTUALLY SOLD IN.
   *
   * products.sizes is what the picker has always drawn from, and the
   * variants are the other account of the same fact. They are written by
   * different code, and both writers swallow their errors on purpose --
   * addSize() and syncSizes() each decide, correctly, that a size list
   * which could not be extended must not fail a receipt or a save.
   *
   * So they can drift, and when they do the shopper is the one who finds
   * out: a product with variants in S, M and L and an empty products.sizes
   * shows no picker at all. Union here rather than trusting one of them,
   * with the stored list first so an order somebody chose is kept.
   * supabase/backfill-sizes.sql repairs the stored column itself, which is
   * what the catalogue CARD needs -- it has only the product row. This is
   * the same repair at render time, for the page that can see both. */
  const sizes = [...(p.sizes || [])];
  for (const s of sizePrices.keys()) {
    if (!sizes.some((had) => had.toLowerCase() === s.toLowerCase())) sizes.push(s);
  }

  /* AFTER the union, not beside it: this reports a balance per size, and
     asking it about the stored list would leave a size the product only
     has a variant for reading as zero -- which the picker draws as sold
     out on a full shelf, the one thing it exists to avoid.
     Null until the shop counts a size in; the picker then reads exactly as
     it always did. */
  const sizeStock = await oneSizeStock(p.id, sizes);

  // Only emitted when reviews genuinely exist. Google treats a fabricated or
  // empty aggregateRating as a structured-data violation, and an honest
  // omission costs nothing next to a manual action against the domain.
  const average = ratingAverage(p);
  const aggregateRating = average != null ? {
    "@type": "AggregateRating",
    ratingValue: average,
    reviewCount: Number(p.rating_count) || 0,
    bestRating: 5,
    worstRating: 1,
  } : undefined;

  // The trail the page already draws, as data a crawler can read. Built
  // from the same `trail` the crumb below renders, so the two can never
  // disagree about where this product sits.
  const breadcrumb = breadcrumbLd(siteOrigin, [
    ...trail.map((c) => ({ name: c.name, path: `/c/${c.slug}` })),
    { name: p.name, path: `/p/${p.slug}` },
  ]);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.description || undefined,
    image: p.images?.length ? p.images : undefined,
    sku: p.ref,
    aggregateRating,
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: p.discount_price || p.price,
      availability:
        p.stock_status === "out" ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      url: siteOrigin ? `${siteOrigin}/p/${p.slug}` : undefined,
    },
  };

  return (
    <div className="wrap">
      <script
        type="application/ld+json"
        // JSON.stringify does NOT escape "<", so a product named
        // "</script><script>…" would break out of this tag and execute on
        // every visitor's page. Escaping < (and the U+2028/2029 line
        // separators, which are literal newlines in JS but legal in JSON)
        // makes the payload inert regardless of what a seller types.
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      {breadcrumb && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }}
        />
      )}
      <p className="crumb">
        <Link href="/">{t("catalog", lang)}</Link>
        {trail.map((c) => (
          <span key={c.id}> / <Link href={`/c/${c.slug}`}>{c.name}</Link></span>
        ))}
        {" / "}
        <span className="mono">{p.ref}</span>
      </p>

      {/* THREE COLUMNS, THE WAY FNAC LAYS A PRODUCT OUT.
          The photograph and what the thing IS on the left, what it is
          LIKE in the middle, and what it COSTS pinned on the right. The
          two-column version put the description under the image, which
          meant scrolling past a 500px photograph to read a sentence --
          and left the middle of a wide screen empty. */}
      <div className="pdp">
        <div className="pdp-media">
          {/* Over the photograph, where FNAC puts it. It was inside the
              price card, which made the price the second thing read. */}
          <h1 className="pdp-nm">{p.name}</h1>
          {average != null && (
            <a className="pdp-rate" href="#reviews">
              <span className="stars" aria-hidden="true">
                {"★★★★★".slice(0, Math.round(average))}
                <span className="stars-off">{"★★★★★".slice(Math.round(average))}</span>
              </span>
              <b>{average.toFixed(1)}</b>
              <span>({Number(p.rating_count) || 0})</span>
            </a>
          )}
          <div className="pdp-media-in">
            <ProductGallery images={p.images} name={p.name} lang={lang} />
            {/* Things you do ABOUT the product rather than to buy it, so
                they sit beside the picture and not in the price card. */}
            <ProductActions p={p} lang={lang} siteOrigin={siteOrigin}
              waNumber={settings.wa_number} />
          </div>
        </div>

        {/* WHAT IT COSTS. Pinned beside the page on a wide screen, so
            the thing a shopper buys with never scrolls away while they
            read the description -- which is why both of the shops this
            borrows from pin it.

            SECOND IN THE DOCUMENT, ahead of the summary, although the
            three-column grid draws it third. Stacked on a phone the
            document order is the only order there is, and having it last
            put the price and the Add to cart button below four hundred
            words of a supplier's description -- measured at 390px, a
            full screen of scrolling to reach the one control the page
            exists for. The grid below places all three columns
            explicitly, so moving it here moves nothing on a wide
            screen, and it puts the buy card ahead of the description
            for a keyboard too. */}
        <div className="pdp-buy">
          <ProductInteractive p={{ ...p, sizes }} settings={settings} lang={lang}
            siteOrigin={siteOrigin} seller={seller} stock={sizeStock}
            /* A plain object, not the Map: this crosses the server ->
               client boundary and a Map does not survive it. */
            sizePrices={Object.fromEntries(sizePrices)} />
        </div>
        {/* WHAT IT IS LIKE. Open panels, not folds: FNAC's Resumo and
            Características are simply there, and a summary worth writing
            is worth showing. They kept their own scroll -- a supplier's
            four hundred words still must not become the page. */}
        <div className="pdp-info">
          {/* CAPPED, AND SCROLLED WHEN IT NEEDS TO BE.
              A seller who pastes a supplier's four hundred words pushes
              the specification, the reviews and the related products off
              the bottom of the screen, and the one thing a shopper is
              looking for -- the price, which is beside this -- ends up
              alone in a tall empty column. tabIndex, because a region
              that scrolls has to be reachable by keyboard. */}
          {/* OPEN, AND FOLDABLE. Both of the shops this borrows from put
              the long text behind a row you expand, and both leave the
              first one open -- so the page is readable at a glance and
              still collapsible once you have read it.

              <details> rather than a component: it needs no JavaScript,
              it is keyboard-operable and screen-reader-announced for
              free, and the browser's own find-in-page opens it. */}
          {p.description?.trim() && (
            <section className="panel pdp-sec">
              <h2>{t("description", lang)}</h2>
              <div className="pdp-scroll" tabIndex={0}
                style={{ whiteSpace: "pre-wrap" }}>{p.description}</div>
            </section>
          )}

          {/* WHAT THIS PARTICULAR PRODUCT IS.
              Drawn from the product type's own attributes, and only the
              ones with an answer: eighteen questions with seven dashes
              beside them is seven rows of nothing to read past, and it
              makes a well-filled listing look like a neglected one. The
              whole block disappears when nothing has been answered, which
              is every product created before the taxonomy existed. */}
          {specs.length > 0 && (
            <section className="panel pdp-sec">
              <h2>{t("specifications", lang)}</h2>
              {/* A sofa answers eighteen questions. Five rows is the
                  height at which this stops being a list and starts being
                  the page, so past that it scrolls in place. */}
              <dl className={"specs" + (specs.length > 5 ? " specs-scroll" : "")}
                tabIndex={specs.length > 5 ? 0 : undefined}>
                {specs.map((s) => (
                  <div key={s.name} className="spec-row">
                    <dt>{s.name}</dt>
                    <dd><SpecValue spec={s} /></dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      </div>

      {/* The anchor the rating above jumps to. */}
      <div id="reviews">
        <ProductReviews p={p} reviews={reviews} lang={lang} />
      </div>

      {related.length > 0 && (
        <>
          <h2>{t("related", lang)}</h2>
          <div className="grid">
            {related.map((r) => (
              <ProductCard key={r.id} p={r} lang={lang} sellerName={sellersById[r.seller_id]?.store_name} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
