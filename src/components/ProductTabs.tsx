"use client";
import { useState } from "react";
import Link from "next/link";
import SpecValue from "./SpecValue";
import { money } from "@/lib/utils";
import { zoneLabelKey, ZONE_IDS } from "@/lib/zones";
import { t } from "@/lib/i18n";
import type { Lang, Settings } from "@/lib/types";
import type { ProductSpec } from "@/lib/data/productSpecs";

/* THE THREE PANELS UNDER THE FOLD.
 *
 * The reference runs Specifications / Reviews (n) / Shipping & Returns as
 * tabs across the full width below the buy area, and that is the right
 * shape for them: all three are things a shopper consults AFTER deciding
 * they are interested, none of them is urgent, and stacked open they
 * pushed the related products off the bottom of a phone.
 *
 * TABS, NOT ACCORDIONS. One of the three is always open, because there is
 * always something worth reading there -- a page where every panel can be
 * shut is a page that can show nothing at all.
 *
 * THE REVIEWS PANEL IS HANDED IN. It is a server component with its own
 * data and its own form, so it is passed as a child rather than rebuilt
 * here; this file decides only which panel is showing.
 */
export default function ProductTabs({
  specs, lang, settings, pay, reviews, reviewCount,
}: {
  specs: ProductSpec[];
  lang: Lang;
  settings: Settings;
  /** Which ways this particular product may be paid for. A product can
   * refuse a method the shop otherwise takes, so this is the product's
   * answer and not the shop's. */
  pay: { cod: boolean; cop: boolean; bank: boolean; wallet: boolean };
  reviews: React.ReactNode;
  reviewCount: number;
}) {
  /* Specifications first when there are any, reviews when there are not.
     Opening on an empty panel is a page that looks broken before it has
     been touched. */
  const [tab, setTab] = useState<"specs" | "reviews" | "ship">(
    specs.length ? "specs" : "reviews");

  const tabs: Array<{ id: typeof tab; label: string }> = [
    ...(specs.length ? [{ id: "specs" as const, label: t("tabSpecs", lang) }] : []),
    { id: "reviews", label: `${t("tabReviews", lang)} (${reviewCount})` },
    { id: "ship", label: t("tabShipping", lang) },
  ];

  const payList: Array<[boolean, string]> = [
    [pay.cod, "pm_cod"], [pay.cop, "pm_cop"], [pay.bank, "pm_bank"], [pay.wallet, "pm_wallet"],
  ];

  const zones = (Array.isArray(settings.zones) ? settings.zones : [])
    .filter((z) => z && ZONE_IDS.includes(z.id));
  const days = Number(settings.legal_return_days);

  return (
    <div className="ptabs">
      {/* role=tablist and the arrow keys it implies. A row of buttons that
          looks like tabs and does not behave like them is worse than a row
          that does not look like them. */}
      <div className="ptabs-hd" role="tablist" aria-label={t("tabSpecs", lang)}>
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab"
            id={`ptab-${x.id}`} aria-controls={`ppanel-${x.id}`}
            aria-selected={tab === x.id}
            className={"ptab" + (tab === x.id ? " is-on" : "")}
            onClick={() => setTab(x.id)}>
            {x.label}
          </button>
        ))}
      </div>

      {tab === "specs" && (
        <section className="ptabs-body panel" role="tabpanel"
          id="ppanel-specs" aria-labelledby="ptab-specs">
          {/* COLUMNS, NOT ONE LONG LIST. A sofa answers eighteen
              questions; down one column that is eighteen rows to scroll
              past, and across three it is six. auto-fit, so a product
              with four answers gets one or two columns rather than three
              with two of them empty. */}
          <dl className="spec-cols">
            {specs.map((sp) => (
              <div key={sp.name} className="spec-row">
                <dt>{sp.name}</dt>
                <dd><SpecValue spec={sp} /></dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {tab === "reviews" && (
        <section className="ptabs-body" role="tabpanel"
          id="ppanel-reviews" aria-labelledby="ptab-reviews">
          {reviews}
        </section>
      )}

      {tab === "ship" && (
        <section className="ptabs-body panel" role="tabpanel"
          id="ppanel-ship" aria-labelledby="ptab-ship">
          <div className="ship-grid">
            {zones.length > 0 && (
              <div>
                <h3>{t("delivery", lang)}</h3>
                <dl className="spec-cols ship-zones">
                  {zones.map((z) => (
                    <div key={z.id} className="spec-row">
                      <dt>{t(zoneLabelKey(z.id), lang)}</dt>
                      {/* A zone the shop quotes for has no number, and
                          printing $0.00 for it would read as free. */}
                      <dd>{z.quote ? t("quoteOnRequest", lang) : money(Number(z.fee))}</dd>
                    </div>
                  ))}
                </dl>
                {settings.pickup && <p className="hint">{t("promisePickup", lang)}</p>}
              </div>
            )}

            {payList.some(([on]) => on) && (
              <div>
                <h3>{t("payAccepted", lang)}</h3>
                <ul className="ship-ticks">
                  {payList.filter(([on]) => on).map(([, key]) => (
                    <li key={key}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                        strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 12.5l5.5 5.5L20 7" />
                      </svg>
                      {t(key, lang)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {Number.isFinite(days) && days > 0 && (
              <div>
                <h3>{t("returnsTitle", lang)}</h3>
                {/* The same number the returns policy prints, read from
                    the same setting. Two places stating a window and one
                    of them guessing is how a shop ends up arguing with a
                    customer holding a screenshot. */}
                <p>{t("promiseReturns", lang).replace("{n}", String(Math.floor(days)))}</p>
                <p className="hint">
                  <Link href="/legal/returns">{t("returnsTitle", lang)}</Link>
                </p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
