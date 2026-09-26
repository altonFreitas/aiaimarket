"use client";
import { t } from "@/lib/i18n";
import { lineCeiling, type BasketLine } from "@/lib/useBasket";
import type { Lang } from "@/lib/types";

/* THE − n + CONTROL, drawn once for both screens that have one.
 *
 * The cart and the checkout summary each had their own copy, identical
 * apart from a height. That is how the + button came to count past the
 * shelf in both of them: the product page was given a ceiling and these two
 * were not, and there was no single place to add one.
 *
 * What it will not do is decide anything. The ceiling comes from the line,
 * the line's ceiling is refreshed when the screen opens, and the database
 * refuses an oversell whatever this button allows -- see
 * reserve_order_stock. This is the polite version of an answer the shop
 * will give anyway; it exists so nobody fills in a delivery address for an
 * order that cannot be placed.
 */
export default function QtyStepper({
  line, onChange, lang, height = 34,
}: {
  line: BasketLine;
  onChange: (qty: number) => void;
  lang: Lang;
  height?: number;
}) {
  const cap = lineCeiling(line);
  const capped = Number.isFinite(cap);
  const soldOut = capped && cap === 0;
  const atCap = capped && !soldOut && line.qty >= cap;

  return (
    <div>
      <div className="qty" style={{ height }}>
        <button type="button" aria-label={t("qty", lang)}
          disabled={line.qty <= 1}
          onClick={() => onChange(line.qty - 1)}>−</button>
        <span>{line.qty}</span>
        {/* Disabled rather than silently clamping: a button that looks
            pressable and does nothing reads as broken, and the shopper
            presses it again. */}
        <button type="button" aria-label={t("qty", lang)}
          disabled={atCap || soldOut}
          onClick={() => onChange(line.qty + 1)}>+</button>
      </div>
      {soldOut && (
        <p className="hint" style={{ color: "var(--red)", margin: "4px 0 0" }}>
          {t("sizeSoldOut", lang)}
        </p>
      )}
      {/* Said only at the ceiling. A running commentary on how much is left
          of everything in the basket is noise; "this is as many as you can
          have" at the moment it becomes true is information. */}
      {atCap && (
        <p className="hint" style={{ margin: "4px 0 0" }}>
          {t(line.size ? "onlyNLeftSize" : "onlyNLeft", lang)
            .replace("{s}", line.size)
            .replace("{n}", String(cap))}
        </p>
      )}
    </div>
  );
}
