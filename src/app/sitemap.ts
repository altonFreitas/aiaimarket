import type { MetadataRoute } from "next";
import { getLiveProducts, getCategories } from "@/lib/data/public";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const [products, categories] = await Promise.all([getLiveProducts(), getCategories()]);

  const staticEntries: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "daily", priority: 1 },
  ];

  const categoryEntries: MetadataRoute.Sitemap = categories.map((c) => ({
    url: `${base}/c/${c.slug}`,
    changeFrequency: "daily",
    priority: 0.7,
  }));

  const productEntries: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${base}/p/${p.slug}`,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [...staticEntries, ...categoryEntries, ...productEntries];
}
