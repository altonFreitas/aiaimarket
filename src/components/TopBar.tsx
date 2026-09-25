import MapLink, { hasPlace } from "./MapLink";
import { t } from "@/lib/i18n";
import type { Lang, Settings } from "@/lib/types";

/** The thin utility strip above the main header.
 *
 * Three facts a shopper wants before they start: that there is delivery,
 * when the shop is open, and where it is. Each with the icon its meaning
 * already has, which is what makes three short phrases in a 12px strip
 * scannable rather than a run-on sentence.
 *
 * EVERY ONE OF THEM DISAPPEARS when its setting is blank, rather than
 * leaving an icon with nothing beside it. The place is a real maps link --
 * the same MapLink the footer and the store pages use -- because "Dili,
 * Timor-Leste" in a header is decoration and a pin you can tap is not.
 *
 * Hidden on narrow screens (see globals.css): none of it earns its space
 * on a 360px screen, and the bottom nav already carries the one thing
 * here that is a destination.
 */
export default function TopBar({ lang, settings }: { lang: Lang; settings: Settings }) {
  const place = [settings.landmark, settings.suku, settings.post, settings.municipality];
  const placeLine = place.filter(Boolean).join(", ");

  return (
    <div className="topbar">
      <div className="topbar-in">
        <span className="topbar-note">
          <TruckIcon />
          {t("freeDelivery", lang)}
        </span>
        <span className="topbar-sp" />
        {settings.hours && (
          <span className="topbar-note topbar-hours">
            <ClockIcon />
            {settings.hours}
          </span>
        )}
        {hasPlace(place) && (
          <span className="topbar-note topbar-place">
            <MapLink parts={place} label={placeLine} />
          </span>
        )}
      </div>
    </div>
  );
}

function TruckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 6h12v10H1zM13 10h4l3 3v3h-7z" />
      <circle cx="6" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  );
}
