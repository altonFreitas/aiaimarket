import { notFound } from "next/navigation";
import { headers } from "next/headers";
import ProductInteractive from "@/components/ProductInteractive";
import { oneSizeStock } from "@/lib/data/sizeStock";
import { sizePricesOf } from "@/lib/data/sizePrices";
import ProductGallery from "@/components/ProductGallery";
import ProductActions from "@/components/ProductActions";
import ProductTabs from "@/components/ProductTabs";
import Crumb from "@/components/Crumb";
import ProductCard from "@/components/ProductCard";
import ProductReviews from "@/components/ProductReviews";
import { getCategories, getProductBySlug, getProductReviews, getRelatedProducts, getSettings, bumpView, getApprovedSellersById } from "@/lib/data/public";
import { productSpecs } from "@/lib/data/productSpecs";
import { productColors } from "@/lib/data/productColors";
import { deliveryPromises, bestZoneFee } from "@/lib/deliveryPromise";
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

  const [related, reviews, specs, sizePrices, colors] = await Promise.all([
    getRelatedProducts(p.category_id, p.id), getProductReviews(p.id),
    // Only what this product actually answers -- see lib/data/productSpecs.
    productSpecs(p.id),
    /* What each size sells for, when the purchase order set them
       separately. Empty for a product bought at one price and for a
       fridge, and then the page quotes the product's own price for
       everything, exactly as it always did. */
    sizePricesOf(p.id),
    /* Which colours it is sold in. Variants when there are any, the
       product's own colour answer when there are not -- see
       lib/data/productColors.ts. */
    productColors(p.id),
  ]);

  /* THE THREE TILES over the description, picked BY MEANING rather than
     by position. Material, Fit and Gender are what the reference lifts
     out, and taking "the first three specs" instead would show a sofa's
     Width, Depth and Height -- true, and not what a shopper scans for.
     Falls through to whatever the product does answer, so a product type
     with none of the three still gets a strip rather than a gap. */
  const TILE_ORDER = ["material", "fit", "gender", "style", "pattern", "brand"];
  const tiles = [...specs]
    .filter((sp) => sp.fieldType !== "color" && sp.value.trim())
    .sort((a, b) => {
      const ia = TILE_ORDER.indexOf(a.slug);
      const ib = TILE_ORDER.indexOf(b.slug);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .slice(0, 3)
    .map((sp) => ({ label: sp.name, value: sp.value }));

  const brand = specs.find((sp) => sp.slug === "brand")?.value ?? null;

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
      <Crumb homeLabel={t("catalog", lang)} steps={[
        ...trail.map((c) => ({ label: c.name, href: `/c/${c.slug}` })),
        { label: p.name },
      ]} />

      {/* THE REFERENCE'S SHAPE. The photograph on the left with its
          thumbnails beside it, what the thing IS and COSTS in the middle,
          and what you choose and press on the right.

          The price sits in the MIDDLE column here, not in the buy panel.
          That is the reference, and it is why ProductInteractive renders
          both of those columns out of one component: this shop's prices
          follow the size, so picking Large on the right has to change the
          number in the middle, and two components could not share that. */}
      <div className="pdp">
        <div className="pdp-media">
          <ProductGallery images={p.images} name={p.name} lang={lang}
            /* Things you do ABOUT the product rather than to buy it, on
               the picture itself -- which is where the reference puts the
               heart and where a shopper is already looking. */
            actions={
              <ProductActions p={p} lang={lang} siteOrigin={siteOrigin}
                waNumber={settings.wa_number} />
            }
            /* A ribbon only when it is EARNED. "Best seller" on a product
               nobody has bought is the kind of claim that costs a shop
               its credibility -- so it is drawn off the same rating the
               stars come from, and only when there are enough reviews
               behind it to mean anything. */
            badge={average != null && average >= 4.5 && (Number(p.rating_count) || 0) >= 5
              ? <span className="gal-tag">{t("bestSeller", lang)}</span>
              : null}
          />
        </div>

        {/* TWO COLUMNS OUT OF ONE COMPONENT -- the summary and the buy
            panel. It returns a fragment, so both land as direct children
            of this grid. */}
        <ProductInteractive p={{ ...p, sizes }} settings={settings} lang={lang}
          siteOrigin={siteOrigin} seller={seller} stock={sizeStock}
          /* A plain object, not the Map: this crosses the server ->
             client boundary and a Map does not survive it. */
          sizePrices={Object.fromEntries(sizePrices)}
          colors={colors} tiles={tiles} brand={brand}
          average={average} ratingCount={Number(p.rating_count) || 0}
          promises={deliveryPromises(settings)} deliveryFee={bestZoneFee(settings)} />
      </div>

      {/* SPECIFICATIONS, REVIEWS AND SHIPPING, as tabs across the full
          width. All three are consulted after the decision to be
          interested; stacked open they pushed the related products off
          the bottom of a phone. The reviews panel is handed in rather
          than rebuilt -- it is a server component with its own data and
          its own form. */}
      <div id="reviews">
        <ProductTabs
          specs={specs} lang={lang} settings={settings}
          pay={{ cod: p.pay_cod, cop: p.pay_cop, bank: p.pay_bank, wallet: p.pay_wallet }}
          reviewCount={Number(p.rating_count) || 0}
          reviews={<ProductReviews p={p} reviews={reviews} lang={lang} />}
        />
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
