/** A PARCEL WITH A LOCATION PIN OVER IT -- the shop's mark for "where is
 * my order".
 *
 * ONE DRAWING, TWO PLACES. It is in the desktop header and in the phone's
 * bottom bar, and when those were two copies of an inline <svg> they
 * disagreed: the header got the parcel and the bottom bar was left holding
 * the magnifying glass, so the same errand wore two different faces
 * depending on the device. A component cannot drift.
 *
 * NOT A MAGNIFYING GLASS, which is what both used to be. The glass is the
 * SEARCH icon and sits a few elements away in the same chrome, so the one
 * control for "where is my order" was dressed as "find a product".
 *
 * Drawn as a carton seen slightly from above rather than a flat rectangle:
 * at 16px a rectangle with a line across it is a rectangle with a line
 * across it, and the two strokes of the open top are what make it read as
 * a parcel. Compared against three other drawings at 15, 16, 18 and 28px
 * before being chosen.
 *
 * aria-hidden, always: every caller puts a word beside it. */
export default function TrackIcon(
  { size = 16, strokeWidth = 1.7 }: { size?: number; strokeWidth?: number },
) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 1.6a3 3 0 0 0-3 3c0 2.1 3 5 3 5s3-2.9 3-5a3 3 0 0 0-3-3Z" />
      <circle cx="12" cy="4.6" r="1" />
      <path d="M4 14.6 12 11.4l8 3.2v5.9L12 23.7l-8-3.2Z" />
      <path d="M4 14.6 12 17.8l8-3.2M12 17.8v5.9" />
    </svg>
  );
}
