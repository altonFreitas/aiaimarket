import { describeColor } from "@/lib/colorName";
import type { ProductSpec } from "@/lib/data/productSpecs";

/** One answer on the product page.
 *
 * Everything is its own text except a colour, which is a number when it is
 * written down and a colour when it is looked at. "#db146b" under "Color"
 * tells a shopper nothing at all; the same value as a swatch and the word
 * "Pink" tells them what they came to find out. The exact value stays
 * beside it in small type for whoever wants it -- a shop matching a
 * supplier's code, usually. */
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
      {c.exact && <span className="spec-hex">{c.exact}</span>}
    </span>
  );
}
