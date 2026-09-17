/* A place, as something you can tap to get directions.
 *
 * The footer has done this for the shop's own address since it was written.
 * A seller's store page needs exactly the same thing for exactly the same
 * reason -- somebody standing in Dili wanting to know where to collect --
 * so the pin and the URL live here rather than in two files that would
 * drift.
 *
 * Not a client component. It renders a link and an inline SVG and holds no
 * state, so it can be rendered on the server like the pages that use it. */

/** Google Maps' documented search URL. Nothing here depends on the visitor
 * having an account or the app being installed: it opens in a browser, and
 * on a phone the operating system hands it to the maps app. */
export function mapsUrl(parts: readonly (string | null | undefined)[]): string {
  const query = parts.filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** True when there is enough of an address to be worth linking.
 *
 * A pin that searches for the empty string lands in the middle of the
 * ocean, which is worse than no pin: it looks like the shop answered the
 * question and got it wrong. */
export function hasPlace(parts: readonly (string | null | undefined)[]): boolean {
  return parts.some((p) => !!p && p.trim() !== "");
}

export function LocationIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true"
      style={{ verticalAlign: "-2px", marginRight: 4 }}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

/** The pin, the words, and the link, for one place.
 *
 * `label` is what the reader sees; `parts` is what the map is asked for,
 * most specific first, so a landmark or street pins the building rather
 * than the general suco. The two differ on purpose -- a store page says
 * "Felgueiras, Portugal" and searches the street address behind it. */
export default function MapLink({
  parts, label, title,
}: {
  parts: readonly (string | null | undefined)[];
  label: React.ReactNode;
  /** Tooltip, and the accessible name when the label is only a place. */
  title?: string;
}) {
  if (!hasPlace(parts)) return null;
  return (
    <a href={mapsUrl(parts)} target="_blank" rel="noopener" title={title}
      style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}>
      <LocationIcon />
      {label}
    </a>
  );
}
