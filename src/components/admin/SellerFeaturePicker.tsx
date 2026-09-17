"use client";
import {
  SELLER_AREAS, GRANTABLE_AREAS, grantableArea, grantableSubsection,
} from "@/lib/sellerFeatures";
import { useState } from "react";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/* What one store may open.
 *
 * The same two-level checklist the owner uses for staff accounts (see
 * AccessPicker), because it is the same decision and running one shop
 * should not mean learning two different ideas of what "access" is.
 *
 * The list is read from SELLER_AREAS rather than typed out here. Add a tab
 * to the app and it appears in this checklist by itself; type it out twice
 * and one of the two eventually goes stale -- which on this screen means an
 * owner unable to grant something they are being paid for.
 *
 * Each box carries a line saying what the store actually gets. The owner is
 * selling these; they should not have to sign in as a seller to remember
 * what "My stock" means. */
/** Same disclosure control as the staff checklist. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true"
      style={{ transform: open ? "rotate(180deg)" : undefined,
               transition: "transform .18s ease" }}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="8.5 10.5 12 14 15.5 10.5" />
    </svg>
  );
}

export default function SellerFeaturePicker({
  lang, features, onChange, disabled,
}: {
  lang: Lang;
  /** Area keys and tab keys together -- see lib/sellerFeatures.ts. */
  features: string[];
  onChange: (f: string[]) => void;
  disabled?: boolean;
}) {
  /* Folds away per area, exactly as the staff checklist does -- see
   * AccessPicker for why a part-granted area starts open and the rest start
   * closed. Three areas today, so there is less to fold; the point is that
   * the two screens behave the same way when a fourth arrives. */
  const areas = SELLER_AREAS.filter(grantableArea);
  const [open, setOpen] = useState<string[]>(() =>
    areas.filter((area) => {
      const tabs = area.subsections.filter(grantableSubsection);
      const picked = tabs.filter((s) => features.includes(s.key));
      return picked.length > 0 && !features.includes(area.key);
    }).map((area) => area.key));

  const toggleOpen = (key: string) =>
    setOpen((o) => o.includes(key) ? o.filter((k) => k !== key) : [...o, key]);

  return (
    <div className="access">
      <fieldset className="access-sections" disabled={disabled}>
        <legend>{t("sellerAccess", lang)}</legend>

        {/* TWO LEVELS, BOTH REAL GRANTS AND NOT THE SAME GRANT.
            The area box means the whole area, INCLUDING tabs added in a
            later version. The tab boxes mean exactly those. See
            sellerCanOpen -- which of the two was ticked is what decides
            whether a new tab appears for this store by itself, and that is
            the difference between a plan and a list. */}
        {areas.map((area) => {
          const tabs = area.subsections.filter(grantableSubsection);
          /* The ones that come with the shop, shown ticked and locked
             rather than left out. The first question anyone asks of this
             list is "where is My orders?" -- answering it in the row it
             belongs to beats a sentence at the bottom. */
          const free = area.subsections.filter((s) => !grantableSubsection(s));
          const whole = features.includes(area.key);
          const picked = tabs.filter((s) => whole || features.includes(s.key));
          const some = picked.length > 0 && !whole;
          const allNow = some && picked.length === tabs.length;

          const isOpen = open.includes(area.key);

          return (
            <div key={area.key}
              className={"access-area" + (whole ? " on" : some ? " part" : "")
                + (isOpen ? " is-open" : "")}>
              <label className="access-area-head">
                <input type="checkbox" checked={whole}
                  // Neither on nor off, because some of the tabs under it
                  // are. Without it "Sales" reads as ungranted while two of
                  // its tabs are ticked.
                  ref={(el) => { if (el) el.indeterminate = some; }}
                  // Ticking it grants the AREA, from either unticked state:
                  // the label says "the whole area, including anything
                  // added later", and a box that cleared your tabs when you
                  // clicked it would do the opposite of what it is labelled.
                  // Only unticking a box that is fully on clears, and it
                  // clears its tabs with it -- they would otherwise survive
                  // invisibly.
                  onChange={() => onChange(
                    whole
                      ? features.filter((k) => k !== area.key && !k.startsWith(area.key + "."))
                      : [...features.filter((k) => !k.startsWith(area.key + ".")), area.key])} />
                <span>
                  <b>{t(area.labelKey, lang)}</b>
                  <em>{whole
                    ? t("accessWholeArea", lang)
                    : allNow
                      ? t("accessAllTabsNow", lang).replace("{n}", String(picked.length))
                      : some
                        ? t("accessSomeTabs", lang).replace("{n}", String(picked.length))
                        : t("accessNoTabs", lang)}</em>
                </span>
                <button type="button" className="access-fold"
                  aria-expanded={isOpen}
                  aria-label={t(isOpen ? "collapse" : "expand", lang)
                    + ": " + t(area.labelKey, lang)}
                  title={t(isOpen ? "collapse" : "expand", lang)}
                  onClick={(e) => { e.preventDefault(); toggleOpen(area.key); }}>
                  <Chevron open={isOpen} />
                </button>
              </label>

              {isOpen && <div className="access-subs">
                {free.map((sub) => (
                  /* Ticked, disabled, and still listed. It is part of being
                     a seller, so there is nothing to decide -- but leaving
                     it out would make the area look emptier than the store
                     actually gets. */
                  <label key={sub.key} className="access-box feat-box on is-locked"
                    title={t("sellerAccessIncluded", lang)}>
                    <input type="checkbox" checked readOnly disabled />
                    <span>
                      <b>{t(sub.labelKey, lang)}</b>
                      <em>{t("sellerAccessIncludedShort", lang)}</em>
                    </span>
                  </label>
                ))}
                {tabs.map((sub) => (
                  <label key={sub.key}
                    className={"access-box feat-box"
                      + (whole || features.includes(sub.key) ? " on" : "")}>
                    <input type="checkbox"
                      checked={whole || features.includes(sub.key)}
                      onChange={() => {
                        if (whole) {
                          /* Unticking one tab of a whole-area grant turns
                             it into a list of the rest. The owner meant
                             "all but this", and the only way to say that is
                             to name what remains. */
                          const rest = tabs.filter((x) => x.key !== sub.key).map((x) => x.key);
                          onChange([...features.filter((k) => k !== area.key), ...rest]);
                          return;
                        }
                        onChange(features.includes(sub.key)
                          ? features.filter((k) => k !== sub.key)
                          : [...features, sub.key]);
                      }} />
                    <span>
                      <b>{t(sub.labelKey, lang)}</b>
                      <em>{t(sub.blurbKey, lang)}</em>
                    </span>
                  </label>
                ))}
              </div>}
            </div>
          );
        })}

        <div className="access-quick">
          <button type="button" className="linkish"
            onClick={() => onChange([...GRANTABLE_AREAS])}>
            {t("selectAll", lang)}
          </button>
          <button type="button" className="linkish" onClick={() => onChange([])}>
            {t("selectNone", lang)}
          </button>
          {/* The areas that are not checkboxes at all -- the dashboard and
              the store's own settings. Saying so stops their absence
              reading as an omission. */}
          <span className="hint">{t("sellerAccessIncluded", lang)}</span>
        </div>
      </fieldset>
    </div>
  );
}
