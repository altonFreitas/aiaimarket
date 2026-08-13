import { notFound } from "next/navigation";
import ProductCard from "@/components/ProductCard";
import { getSellerBySlug, getLiveProducts, getSellerRatings } from "@/lib/data/public";
import { getLang } from "@/lib/lang";
import { nowIso } from "@/lib/utils";
import { t } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const seller = await getSellerBySlug(slug);
  if (!seller) return { title: "404" };
  return { title: seller.store_name, description: seller.description?.slice(0, 150) };
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

  const [allProducts, ratings] = await Promise.all([getLiveProducts(), getSellerRatings(seller.id)]);
  const products = allProducts.filter((p) => p.seller_id === seller.id);

  return (
    <div className="wrap">
      <div className="panel">
        <h1>{seller.store_name}</h1>
        {seller.description && <p className="sub">{seller.description}</p>}
        <p className="sub">
          {[seller.city, seller.country].filter(Boolean).join(", ")}
          {(seller.city || seller.country) && products.length ? " · " : ""}
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
