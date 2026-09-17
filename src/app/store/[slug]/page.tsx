import { notFound } from "next/navigation";
import ProductCard from "@/components/ProductCard";
import {
  getSellerBySlug, getLiveProducts, getSellerRatings, getSellerPublicAddress,
} from "@/lib/data/public";
import { getLang } from "@/lib/lang";
import { localeMetadata } from "@/lib/locale";
import { nowIso } from "@/lib/utils";
import { t } from "@/lib/i18n";
import MapLink, { hasPlace } from "@/components/MapLink";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const [{ slug }, lang] = await Promise.all([params, getLang()]);
  const seller = await getSellerBySlug(slug);
  // No alternates on a 404: there is no page here in any language, and
  // naming three URLs for one would invite a crawler to fetch two more.
  if (!seller) return { title: "404" };
  return {
    title: seller.store_name,
    description: seller.description?.slice(0, 150),
    // A storefront renders in whichever language the shopper asked for,
    // so it has the same three URLs every other public page has and needs
    // to say so. Without this the three compete with each other for the
    // seller's own name.
    ...localeMetadata(lang, `/store/${seller.slug}`),
  };
}

/** Public storefront for one seller. Only reachable for an approved
 * seller (getSellerBySlug reads through the sellers_public_read RLS
 * policy, which filters to status="approved" at the database level --
 * a pending/rejected/suspended seller's page 404s, it doesn't leak a
 * half-built page). */
export default async function SellerStorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [lang, seller] = await Promise.all([getLang(), getSellerBySlug(slug)]);
  if (!seller) notFound();

  const [allProducts, ratings, publicAddress] = await Promise.all([
    getLiveProducts(), getSellerRatings(seller.id), getSellerPublicAddress(seller.id),
  ]);
  const products = allProducts.filter((p) => p.seller_id === seller.id);

  /* The street first when the seller published it, city and country
     otherwise -- one list, used both for the words and for the map query,
     so the two can never disagree again. */
  const place = publicAddress
    ? [publicAddress, seller.city, seller.country]
    : [seller.city, seller.country];

  return (
    <div className="wrap">
      <div className="panel">
        <h1>{seller.store_name}</h1>
        {seller.description && <p className="sub">{seller.description}</p>}
        {/* WHERE THE STORE IS, as something you can tap.
            The place was already printed here and was only ever text, so a
            customer deciding whether to collect had to copy it into a map
            by hand.

            THE STREET ADDRESS ONLY IF THE SELLER PUBLISHED IT. sellers.address
            is not granted to anon at all, and getSellerPublicAddress() hands
            it over only for an approved store that ticked the box in its own
            settings. Every other store shows its city, which is as precise as
            the marketplace was ever told it could be.

            WHAT IS PRINTED IS WHAT IS PINNED, and that is the point. An
            earlier version put the street in the map query and kept the
            visible words at city and country, so ticking the box changed
            only a hidden URL: the seller saw no difference and could not
            tell what they had agreed to. A consent switch whose effect is
            invisible to the person giving consent is not one. The switch's
            own hint says "leave this off and customers see only your city
            and country" -- this line is what makes that true.

            Nothing renders when even the city is blank: a map link with no
            place searches for the empty string and lands in the ocean,
            which reads as the shop answering the question and getting it
            wrong. */}
        <p className="sub">
          <MapLink
            parts={place}
            title={t("storeLocationHint", lang)}
            label={place.filter(Boolean).join(", ")} />
          {hasPlace(place) && products.length ? " · " : ""}
          {products.length > 0 && `${products.length} ${t("storeProductCount", lang)}`}
        </p>
        {ratings.count > 0 && (
          <p className="sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--amber-ink)" }}>
              {"★".repeat(Math.round(ratings.average))}{"☆".repeat(5 - Math.round(ratings.average))}
            </span>
            <b>{ratings.average.toFixed(1)}</b>
            <span>({ratings.count} {t("reviews", lang)})</span>
          </p>
        )}
      </div>

      {ratings.reviews.length > 0 && (
        <div className="panel" style={{ marginTop: 12 }}>
          <h3>{t("reviews", lang)}</h3>
          {ratings.reviews.map((r) => (
            <div key={r.id} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
              <div style={{ color: "var(--amber-ink)" }}>
                {"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}
              </div>
              {r.comment && <p style={{ margin: "4px 0 0", fontSize: 13.5 }}>{r.comment}</p>}
              <p className="hint" style={{ margin: "4px 0 0" }}>{nowIso(r.created_at)}</p>
            </div>
          ))}
        </div>
      )}

      {products.length ? (
        <div className="grid" style={{ marginTop: 14 }}>
          {products.map((p) => (
            <ProductCard key={p.id} p={p} lang={lang} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <p>{t("noResults", lang)}</p>
        </div>
      )}
    </div>
  );
}
