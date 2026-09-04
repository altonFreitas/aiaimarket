"use client";
import {
  SELLER_FEATURES, SELLABLE_FEATURES, type SellerFeatureKey,
} from "@/lib/sellerFeatures";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* What one store may open.
 *
 * The list is read from SELLER_FEATURES rather than typed out here. Add a
 * feature to the app and it appears in this checklist by itself; type it
 * out twice and one of the two eventually goes stale -- which on this
 * screen means an owner unable to grant something they are being paid for.
 *
 * Each box carries a line saying what the store actually gets. The owner
 * is selling these; they should not have to sign in as a seller to
 * remember what "Stock" means. */
export default function SellerFeaturePicker({
  lang, features, onChange, disabled,
}: {
  lang: Lang;
  features: SellerFeatureKey[];
  onChange: (f: SellerFeatureKey[]) => void;
  disabled?: boolean;
}) {
  const toggle = (key: SellerFeatureKey) =>
    onChange(features.includes(key) ? features.filter((f) => f !== key) : [...features, key]);

  return (
    <div className="access">
      <fieldset className="access-sections" disabled={disabled}>
        <legend>{t("sellerAccess", lang)}</legend>
        <div className="access-grid">
          {SELLER_FEATURES.filter((f) => !f.included).map((f) => (
            <label key={f.key} className={"access-box feat-box" + (features.includes(f.key) ? " on" : "")}>
              <input type="checkbox" checked={features.includes(f.key)}
                onChange={() => toggle(f.key)} />
              <span>
                <b>{t(f.labelKey, lang)}</b>
                <em>{t(f.blurbKey, lang)}</em>
              </span>
            </label>
          ))}
        </div>
        <div className="access-quick">
          <button type="button" className="linkish"
            onClick={() => onChange([...SELLABLE_FEATURES])}>
            {t("selectAll", lang)}
          </button>
          <button type="button" className="linkish" onClick={() => onChange([])}>
            {t("selectNone", lang)}
          </button>
          {/* The four included screens are not checkboxes. Saying so here
              stops their absence reading as an omission -- the first
              question anyone asks of this list is "where is Products?". */}
          <span className="hint">{t("sellerAccessIncluded", lang)}</span>
        </div>
      </fieldset>
    </div>
  );
}
