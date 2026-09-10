import type { MetadataRoute } from "next";
import { getLiveProducts, getCategories } from "@/lib/data/public";
import { LOCALES, localePath, localeAlternates } from "@/lib/locale";

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

  /* ONE ENTRY PER PAGE PER LANGUAGE, each carrying its alternates.
   *
   * 1,023 translated strings were doing no search work at all, because all
   * three languages rendered at one URL. Three URLs is half the fix; this
   * is the other half -- telling Google that the three are the same page in
   * different languages rather than three pages competing with each other.
   *
   * Google reads hreflang from a sitemap as readily as from a <link>, and
   * a sitemap is the only place to state it for a page nobody has linked
   * to yet, which on a new shop is most of them. */
  const forEveryLocale = (
    path: string,
    lastModified: Date | undefined,
    changeFrequency: "daily" | "weekly",
    priority: number,
  ): MetadataRoute.Sitemap =>
    LOCALES.map((lang) => ({
      url: `${base}${localePath(lang, path)}`,
      lastModified,
      changeFrequency,
      priority,
      alternates: {
        languages: Object.fromEntries(
          Object.entries(localeAlternates(path)).map(([code, p]) => [code, `${base}${p}`]),
        ),
      },
    }));

  const staticEntries: MetadataRoute.Sitemap = [
    ...forEveryLocale("/", newest, "daily", 1),
    ...forEveryLocale("/shop", newest, "daily", 0.9),
  ];

  // A category has no timestamp of its own and does not need one: what
  // changes about /c/shoes is the products in it, so it is dated by the
  // freshest of those. A category nobody has filled yet carries no date.
  const categoryEntries: MetadataRoute.Sitemap = categories.map((c) => {
    const own = products
      .filter((p) => p.category_id === c.id)
      .map((p) => date(p.updated_at) || date(p.created_at))
      .filter((d): d is Date => d != null);
    return forEveryLocale(
      `/c/${c.slug}`,
      own.length ? new Date(Math.max(...own.map((d) => d.getTime()))) : undefined,
      "daily",
      0.7,
    );
  }).flat();

  const productEntries: MetadataRoute.Sitemap = products.flatMap((p) =>
    forEveryLocale(
      `/p/${p.slug}`,
      date(p.updated_at) || date(p.created_at),
      "weekly",
      0.8,
    ));

  return [...staticEntries, ...categoryEntries, ...productEntries];
}
