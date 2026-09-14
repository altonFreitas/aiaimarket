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
      stroke="currentColor" strokeWidth={strokeWidth} aria-hidden="true">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}
