import { notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import ProductInteractive from "@/components/ProductInteractive";
import ProductGallery from "@/components/ProductGallery";
import ProductCard from "@/components/ProductCard";
import Footer from "@/components/Footer";
import { getCategories, getLiveProducts, getProductBySlug, getSettings, bumpView } from "@/lib/data/public";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await getProductBySlug(slug);
  if (!p) return { title: "404" };
  return {
    title: p.name,
    description: p.description?.slice(0, 150),
    openGraph: { title: p.name, images: p.images?.length ? [p.images[0]] : [] },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [lang, settings, p, cats] = await Promise.all([
    getLang(), getSettings(), getProductBySlug(slug), getCategories(),
  ]);
  if (!p) notFound();

  // E4 view counter — fire and forget, never blocks the render
  void bumpView(p.id).catch(() => {});

  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  const proto = h.get("x-forwarded-proto") || "https";
  const siteOrigin = host ? `${proto}://${host}` : "";

  const cat = cats.find((c) => c.id === p.category_id);
  const parent = cat?.parent_id ? cats.find((c) => c.id === cat.parent_id) : null;
  const trail = [parent, cat].filter(Boolean) as typeof cats;

  const all = await getLiveProducts();
  const related = all.filter((x) => x.category_id === p.category_id && x.id !== p.id).slice(0, 4);

  return (
    <div className="wrap">
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
          <ProductGallery images={p.images} name={p.name} />
          <div className="panel" style={{ marginTop: 12 }}>
            <h3>{t("description", lang)}</h3>
            <div style={{ whiteSpace: "pre-wrap" }}>{p.description}</div>
          </div>
        </div>
        <div>
          <h1>{p.name}</h1>
          <ProductInteractive p={p} settings={settings} lang={lang} siteOrigin={siteOrigin} />
        </div>
      </div>

      {related.length > 0 && (
        <>
          <h2>{t("related", lang)}</h2>
          <div className="grid">
            {related.map((r) => (
              <ProductCard key={r.id} p={r} lang={lang} />
            ))}
          </div>
        </>
      )}
      <Footer settings={settings} />
    </div>
  );
}
