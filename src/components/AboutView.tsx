import Link from "next/link";
import MapLink, { hasPlace } from "@/components/MapLink";
import StoreMark from "@/components/StoreMark";
import { taglineOf } from "@/lib/tagline";
import { t } from "@/lib/i18n";
import type { Lang, Settings } from "@/lib/types";

/** WHO THE SHOP IS.
 *
 * THE FACTS COME FROM SETTINGS, THE PROSE FROM THE STRING TABLE, and the
 * split is deliberate. The hours, the address and the registration number
 * are things that change and that the owner maintains; they are read from
 * the settings row, and each block disappears when its setting is blank
 * rather than leaving a heading with nothing under it.
 *
 * The paragraph is page copy, translated like every other sentence on the
 * site -- the same place the hero's headline lives. It is not invented on
 * the shop's behalf: it is the text the shop supplied, in i18n.ts where
 * it can be edited and where Tetum and Portuguese readers get their own
 * version rather than an English one.
 *
 * A component rather than the page itself, for the same reason as
 * ContactView: a page that reads its own data can only be looked at with
 * a database behind it.
 */
export default function AboutView({ settings, lang }: { settings: Settings; lang: Lang }) {
  const place = [settings.landmark, settings.suku, settings.post, settings.municipality];
  const placeLine = place.filter(Boolean).join(", ");
  const tagline = taglineOf(settings, lang);

  const features = [
    { icon: <ShieldIcon />, title: t("featQuality", lang), sub: t("featQualitySub", lang) },
    { icon: <TruckIcon />, title: t("featDelivery", lang), sub: t("featDeliverySub", lang) },
    { icon: <HeartIcon />, title: t("featSupport", lang), sub: t("featSupportSub", lang) },
  ];

  return (
    <div className="wrap">
      <section className="infopage">
        <div className="infopage-copy">
          <p className="eyebrow">
            <PeopleIcon />
            {t("aboutEyebrow", lang)}
          </p>
          <h1>{t("aboutTitle", lang)}</h1>
          <p className="infopage-store">{settings.store_name}</p>
          <p className="infopage-lead">{t("aboutLead", lang)}</p>
          {/* The shop's own one-liner, when it has set one. Under the
              paragraph rather than instead of it: they say different
              things, and a tagline is a slogan rather than a story. */}
          {tagline && <p className="infopage-tag">{tagline}</p>}

          <div className="feats">
            {features.map((f) => (
              <div key={f.title} className="feat">
                <span className="feat-ic">{f.icon}</span>
                <div>
                  <b>{f.title}</b>
                  <span>{f.sub}</span>
                </div>
              </div>
            ))}
          </div>

          <p className="infopage-more">
            <Link href="/contact">
              <ArrowUpRight />
              {t("aboutMore", lang)}
            </Link>
          </p>
        </div>

        <div className="infopage-aside">
          {settings.hours && (
            <div className="infotile is-blue">
              <span className="infocard-ic is-blue"><ClockIcon /></span>
              <div>
                <span className="infocard-hd">{t("aboutHours", lang)}</span>
                <p>{settings.hours}</p>
              </div>
            </div>
          )}

          {hasPlace(place) && (
            <div className="infotile is-green">
              <span className="infocard-ic is-green"><PinIcon /></span>
              <div>
                <span className="infocard-hd">{t("aboutWhere", lang)}</span>
                <p><MapLink parts={place} label={placeLine} /></p>
                {settings.pickup && <small>{t("aboutPickup", lang)}</small>}
              </div>
            </div>
          )}

          {/* The reference has a photograph of the shop front here. This
              one has no such photograph, and a stock picture of somewhere
              that is not Dili would be worse than none -- so it is the
              shop's own mark. See StoreMark. */}
          <StoreMark label={settings.store_name} />
        </div>
      </section>

      {/* The paperwork, when the shop has filled it in. Below the fold
          rather than beside the story: a registration number is something
          somebody comes looking for, not something anybody reads. */}
      {(settings.legal_registration || settings.legal_address) && (
        <section className="panel infopage-legal">
          <h3>{t("aboutRegistered", lang)}</h3>
          {settings.legal_registration && (
            <p className="mono">{settings.legal_registration}</p>
          )}
          {settings.legal_address && <p>{settings.legal_address}</p>}
          <p className="hint">
            <Link href="/legal/terms">{t("termsPrivacyTitle", lang)}</Link>
            {" · "}
            <Link href="/legal/returns">{t("returnsTitle", lang)}</Link>
          </p>
        </section>
      )}
    </div>
  );
}

const stroke = {
  fill: "none", stroke: "currentColor", strokeWidth: 2,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
function PeopleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
      <circle cx="9" cy="8" r="3" /><path d="M2 20c0-3.3 3.1-6 7-6s7 2.7 7 6" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6M18 20c0-2.2-.9-4-2.4-5.2" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <path d="M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function TruckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <path d="M1 6h12v10H1zM13 10h4l3 3v3h-7z" />
      <circle cx="6" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" />
    </svg>
  );
}
function HeartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0z" /><circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}
function ArrowUpRight() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <path d="M7 17 17 7M9 7h8v8" />
    </svg>
  );
}
