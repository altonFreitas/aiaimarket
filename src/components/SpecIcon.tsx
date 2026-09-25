/* THE MARK BESIDE A FACT TILE.
 *
 * The reference draws a small outline icon at the left of each of the
 * three tiles over the description -- a fabric swirl for the material, a
 * shirt for the fit, a figure for who it is for.
 *
 * BY SLUG, WHICH IS WHY ProductSpec CARRIES ONE. The tiles are picked by
 * meaning rather than by position (see the product page), and the icon
 * has to follow the same rule: matching on the shop's own wording would
 * mean "Material" got a picture and "Materiál" did not.
 *
 * A TAG IS THE FALLBACK, not a blank. Every product type has its own
 * attributes -- a fridge answers Capacity and Energy rating, a supplement
 * answers Flavour -- and there is no drawing that means "capacity". One
 * tile with an icon and two without reads as two icons that failed to
 * load; a neutral mark on all three reads as a set.
 *
 * Server-rendered: an SVG and a switch, no state.
 */
export default function SpecIcon({ slug }: { slug: string }) {
  const common = {
    width: 18, height: 18, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.7,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (slug) {
    // Cloth: a bolt of fabric with a fold in it.
    case "material":
    case "fabric":
      return (
        <svg {...common}>
          <path d="M4 7c2-2 4-2 6 0s4 2 6 0 2-1 4 0" />
          <path d="M4 12c2-2 4-2 6 0s4 2 6 0 2-1 4 0" />
          <path d="M4 17c2-2 4-2 6 0s4 2 6 0 2-1 4 0" />
        </svg>
      );
    // A shirt, for how it is cut.
    case "fit":
    case "style":
      return (
        <svg {...common}>
          <path d="M8 3L4 5l1 4 2-.6V21h10V8.4l2 .6 1-4-4-2" />
          <path d="M9 3a3 3 0 0 0 6 0" />
        </svg>
      );
    // A figure, for who it is for.
    case "gender":
    case "audience":
      return (
        <svg {...common}>
          <circle cx="12" cy="7" r="3.2" />
          <path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7" />
        </svg>
      );
    // A pattern, as repeating marks.
    case "pattern":
      return (
        <svg {...common}>
          <path d="M4 8h4M10 8h4M16 8h4M4 12h4M10 12h4M16 12h4M4 16h4M10 16h4M16 16h4" />
        </svg>
      );
    // A label with a hole in it -- the brand.
    case "brand":
      return (
        <svg {...common}>
          <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 3 12V4a1 1 0 0 1 1-1h8a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.6z" />
          <circle cx="7.5" cy="7.5" r="1.2" />
        </svg>
      );
    // A sun, for the season.
    case "season":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    // A ruler, for anything measured.
    case "size":
    case "length":
    case "capacity":
      return (
        <svg {...common}>
          <rect x="2" y="8" width="20" height="8" rx="1.5" />
          <path d="M7 8v3M12 8v4M17 8v3" />
        </svg>
      );
    default:
      // A luggage tag. Means "a fact about this product" and nothing
      // more, which is exactly what is known here.
      return (
        <svg {...common}>
          <path d="M4 5h11l5 7-5 7H4z" />
          <circle cx="16" cy="12" r="1.2" />
        </svg>
      );
  }
}
