import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import ProductInteractive from "@/components/ProductInteractive";
import ProductGallery from "@/components/ProductGallery";
import ProductCard from "@/components/ProductCard";
import ProductReviews from "@/components/ProductReviews";
import { getCategories, getLiveProducts, getProductBySlug, getProductReviews, getSettings, bumpView, getApprovedSellersById } from "@/lib/data/public";
import { ratingAverage } from "@/lib/utils";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await getProductBySlug(slug);
  if (!p) return { title: "404" };
  const description = p.description?.slice(0, 150);
  const images = p.images?.length ? [p.images[0]] : [];
  return {
    title: p.name,
    description,
    alternates: { canonical: `/p/${p.slug}` },
    openGraph: { type: "website", url: `/p/${p.slug}`, title: p.name, description, images },
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

  const [all, reviews] = await Promise.all([getLiveProducts(), getProductReviews(p.id)]);
  const related = all.filter((x) => x.category_id === p.category_id && x.id !== p.id).slice(0, 4);

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
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd)
            .replace(/</g, "\\u003c")
            .replace(/\u2028/g, "\\u2028")
            .replace(/\u2029/g, "\\u2029"),
        }}
      />
      <p className="crumb">
        <Link href="/">{t("catalog", lang)}</Link>
        {trail.map((c) => (
          <span key={c.id}> / <Link href={`/c/${c.slug}`}>{c.name}</Link></span>
        ))}
        {" / "}
        <span className="mono">{p.ref}</span>
      </p>

      <div className="pdp">
        <div>
          <ProductGallery images={p.images} name={p.name} lang={lang} />
          <div className="panel" style={{ marginTop: 12 }}>
            <h3>{t("description", lang)}</h3>
            <div style={{ whiteSpace: "pre-wrap" }}>{p.description}</div>
          </div>
        </div>
        <div>
          <h1>{p.name}</h1>
          <ProductInteractive p={p} settings={settings} lang={lang} siteOrigin={siteOrigin} seller={seller} />
        </div>
      </div>

      <ProductReviews p={p} reviews={reviews} lang={lang} />

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
