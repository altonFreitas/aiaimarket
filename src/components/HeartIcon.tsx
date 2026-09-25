/* THE SHOP'S HEART, DRAWN ONCE.
 *
 * The same mark appears on every catalogue card and now on the product
 * page's action rail. It was a `const HEART` inside ProductCard, which is
 * how the second use would have ended up subtly different -- a stroke
 * width, a lobe, a viewBox -- and how the two would have drifted apart the
 * day anybody redrew either. The same argument CartIcon makes for itself.
 *
 * A square turned on its point with a lobe on each shoulder: the tip at
 * (12, 21.23), the notch at (12, 5.67), and the two extremes at x=3.16 and
 * x=20.84 -- 8.84 either side of the centre line, so it is symmetrical.
 * The one before it was drawn by hand, leaned right, and at card size read
 * as a smudge rather than a heart.
 */
export const HEART_PATH =
  "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";

export default function HeartIcon({
  size = 19, filled = false, rimmed = false,
}: {
  size?: number;
  /** Solid when this browser has hearted it, outline when it has not. */
  filled?: boolean;
  /** A dark rim under the mark, wider than it.
   *
   * ONLY FOR A HEART OVER A PHOTOGRAPH. On the catalogue card it sits on
   * whatever colour the product happens to be, so it has to hold its own
   * over a dark boot AND over a sandal shot against a white wall -- which
   * one colour cannot do, and which a blurred shadow only smudges. On a
   * panel it has a known background behind it and the rim would just read
   * as a smudge. */
  rimmed?: boolean;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill="none" strokeLinecap="round" strokeLinejoin="round">
      {rimmed && <path d={HEART_PATH} stroke="rgba(0,0,0,.5)" strokeWidth="4.5" />}
      <path d={HEART_PATH} stroke="currentColor" strokeWidth="2"
        fill={filled ? "currentColor" : "none"} />
    </svg>
  );
}
