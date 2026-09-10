import type { MetadataRoute } from "next";
import { getLiveProducts, getCategories } from "@/lib/data/public";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const [products, categories] = await Promise.all([getLiveProducts(), getCategories()]);

  /* <lastmod>, and only where it is true.
   *
   * A crawler uses it to decide whether re-fetching a page is worth a
   * request, so a wrong date is worse than no date: too old and it stops
   * coming back to a page whose price changed this morning, too new and it
   * learns to ignore the field entirely. So each entry below is dated from
   * something the database actually recorded, and anything that has no such
   * record ships no date at all rather than today's. */
  const date = (value?: string | null): Date | undefined => {
    if (!value) return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };

  // The freshest product in the catalog IS the homepage's last change --
  // it lists new arrivals and best sellers, both drawn from these rows.
  const productDates = products
    .map((p) => date(p.updated_at) || date(p.created_at))
    .filter((d): d is Date => d != null);
  const newest = productDates.length
    ? new Date(Math.max(...productDates.map((d) => d.getTime())))
    : undefined;

  const staticEntries: MetadataRoute.Sitemap = [
    { url: base, lastModified: newest, changeFrequency: "daily", priority: 1 },
    { url: `${base}/shop`, lastModified: newest, changeFrequency: "daily", priority: 0.9 },
  ];

  // A category has no timestamp of its own and does not need one: what
  // changes about /c/shoes is the products in it, so it is dated by the
  // freshest of those. A category nobody has filled yet carries no date.
  const categoryEntries: MetadataRoute.Sitemap = categories.map((c) => {
    const own = products
      .filter((p) => p.category_id === c.id)
      .map((p) => date(p.updated_at) || date(p.created_at))
      .filter((d): d is Date => d != null);
    return {
      url: `${base}/c/${c.slug}`,
      lastModified: own.length ? new Date(Math.max(...own.map((d) => d.getTime()))) : undefined,
      changeFrequency: "daily" as const,
      priority: 0.7,
    };
  });

  const productEntries: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${base}/p/${p.slug}`,
    lastModified: date(p.updated_at) || date(p.created_at),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [...staticEntries, ...categoryEntries, ...productEntries];
}
