/* Structured data, built from things the shop already knows.
 *
 * Every graph here is derived from real rows -- a category that exists, a
 * rating that was left, a name somebody typed. Nothing is invented to fill
 * a required field, because a fabricated aggregateRating or a breadcrumb
 * to a page that does not exist is a structured-data violation, and a
 * manual action against the domain costs far more than the rich result was
 * worth.
 *
 * Serialised by the caller through the same escaping the product page
 * already uses: JSON.stringify does not escape "<", so a product named
 * "</script><script>…" would break out of the tag it is written into.
 */

/** The escaping every <script type="application/ld+json"> in this app must
 * pass its payload through. U+2028 and U+2029 are literal newlines in
 * JavaScript and legal inside a JSON string, so they break the parse too. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export interface Crumb { name: string; path: string }

/** BreadcrumbList for a page whose trail the app already renders on screen.
 *
 * Returns null without an absolute origin: schema.org positions are URLs,
 * and a relative one is not a URL. Emitting it half-formed is worse than
 * not emitting it -- Google reports it as an error against the page rather
 * than ignoring it. */
export function breadcrumbLd(origin: string, crumbs: Crumb[]) {
  if (!origin || !crumbs.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${origin}${c.path}`,
    })),
  };
}

/** The shop itself, emitted once in the root layout.
 *
 * Organization is what puts a name and a logo beside the domain in a search
 * result; WebSite with a SearchAction is what can turn it into a search box.
 * Both are true of this shop -- /search exists and takes ?q= -- so neither
 * is a claim it cannot back up.
 *
 * The two are returned as one @graph rather than two script tags: they
 * reference each other, and a graph is how that relationship is expressed
 * rather than left for a crawler to guess. */
export function siteLd(input: {
  origin: string;
  storeName: string;
  description?: string;
  /** Municipality and suku, if the shop has said where it is. */
  locality?: string;
  region?: string;
  phone?: string;
}) {
  if (!input.origin || !input.storeName) return null;
  const org = {
    "@type": "Organization",
    "@id": `${input.origin}#organization`,
    name: input.storeName,
    url: input.origin,
    logo: `${input.origin}/icon-512.png`,
    ...(input.description ? { description: input.description } : {}),
    ...(input.phone ? { telephone: input.phone } : {}),
    // Only when the shop has actually filled its address in. A postalAddress
    // with empty strings in it is worse than none.
    ...(input.locality || input.region ? {
      address: {
        "@type": "PostalAddress",
        addressCountry: "TL",
        ...(input.locality ? { addressLocality: input.locality } : {}),
        ...(input.region ? { addressRegion: input.region } : {}),
      },
    } : {}),
  };
  return {
    "@context": "https://schema.org",
    "@graph": [
      org,
      {
        "@type": "WebSite",
        "@id": `${input.origin}#website`,
        url: input.origin,
        name: input.storeName,
        publisher: { "@id": org["@id"] },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${input.origin}/search?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}
