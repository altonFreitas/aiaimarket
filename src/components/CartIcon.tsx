/* THE SHOP'S CART, DRAWN ONCE.
 *
 * The same bag appears in the header, in the bottom bar on a phone, and now
 * on every "Add to cart" button in the catalog. It was copied by hand into
 * the first two, which is how the third would have ended up subtly
 * different -- a stroke width, a corner, a viewBox -- and how the header
 * would have drifted away from the button the day anybody redrew either.
 *
 * Sized by the caller because the three uses are genuinely different sizes,
 * and inherits its colour from the text beside it: on the amber button that
 * is the dark ink, in the header it is the paper colour, and neither wants
 * to be stated twice.
 */
export default function CartIcon(
  { size, strokeWidth = 2 }: { size?: number; strokeWidth?: number }
) {
  // No width/height at all when the caller does not give a size: the bottom
  // bar sizes its icons in CSS, and hard-coding 17px here would override it.
  return (
    <svg {...(size ? { width: size, height: size } : {})}
      viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* A TROLLEY, not a bag. The bag read as "shopping" in general; a
          trolley reads as "the things I am buying right now", which is what
          this icon opens. Drawn to the same 24-box and stroke as the rest of
          the set so it sits level with the icons beside it. */}
      <path d="M2 3h2.2l.9 4m0 0 2.1 9h11.1l2.7-9H5.1Z" />
      <circle cx="9" cy="20" r="1.6" />
      <circle cx="18" cy="20" r="1.6" />
    </svg>
  );
}
