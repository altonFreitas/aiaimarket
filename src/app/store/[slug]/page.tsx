import { notFound } from "next/navigation";
import ProductCard from "@/components/ProductCard";
import { getSellerBySlug, getLiveProducts } from "@/lib/data/public";
import { getLang } from "@/lib/lang";
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

  const allProducts = await getLiveProducts();
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
      </div>

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
