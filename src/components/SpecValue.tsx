import { describeColor } from "@/lib/colorName";
import type { ProductSpec } from "@/lib/data/productSpecs";

/** One answer on the product page.
 *
 * Everything is its own text except a colour, which is a number when it is
 * written down and a colour when it is looked at. "#db146b" under "Color"
 * tells a shopper nothing at all; the same value as a swatch and the word
 * "Magenta" tells them what they came to find out.
 *
 * AND THAT IS ALL IT SAYS. The hex used to sit beside the name in small
 * type, for a shop matching a supplier's code. It was the wrong audience:
 * this is the buyer's page, the buyer cannot use a hex for anything, and
 * a swatch with a number after it reads as a swatch that failed to
 * resolve. Whoever needs the exact value has the product form, where they
 * typed it. */
export default function SpecValue({ spec }: { spec: ProductSpec }) {
  if (spec.fieldType !== "color") return <>{spec.value}</>;

  const c = describeColor(spec.value);
  if (!c) return <>{spec.value}</>;

  return (
    <span className="spec-color">
      {c.swatch && (
        <span className="spec-swatch" style={{ background: c.swatch }} aria-hidden="true" />
      )}
      {c.name}
    </span>
  );
}
