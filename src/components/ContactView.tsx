import Link from "next/link";
import MapLink, { hasPlace } from "@/components/MapLink";
import StoreMark from "@/components/StoreMark";
import { waLink, waNumberDigits } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Lang, Settings } from "@/lib/types";

/** HOW TO REACH THE SHOP.
 *
 * WhatsApp first, and deliberately: it is how this shop already takes
 * orders -- every product page has an "Order via WhatsApp" button -- so a
 * contact page leading with an email form would be offering a slower
 * channel than the one the shop actually answers.
 *
 * NO CONTACT FORM. A form needs somewhere to deliver to, and this shop
 * has no mail transport configured; a box that swallows a message and
 * says "thank you" is worse than no box.
 *
 * Each card disappears when its setting is blank, so a shop that has
 * filled in two of three things shows two rather than two facts and an
 * empty frame.
 *
 * A component rather than the page itself: everything here is decided by
 * the settings row, and a page that reads its own data can only be looked
 * at with a database behind it. Taking settings as a prop is what lets
 * this be rendered against a filled-in shop while it is being designed.
 */
export default function ContactView({ settings, lang }: { settings: Settings; lang: Lang }) {
  const place = [settings.landmark, settings.suku, settings.post, settings.municipality];
  const placeLine = place.filter(Boolean).join(", ");

  return (
    <div className="wrap">
      <section className="infopage">
        <div className="infopage-copy">
          <p className="eyebrow">
            <HeadsetIcon />
            {t("contactEyebrow", lang)}
          </p>
          <h1>{t("contactTitle", lang)}</h1>
          <p className="infopage-store">{settings.store_name}</p>
          <p className="infopage-lead">{t("contactLead", lang)}</p>

          <div className="infocards">
            {settings.wa_number && (
              <a className="infocard" target="_blank" rel="noopener"
                href={waLink(waNumberDigits(settings), t("contactWaGreeting", lang))}>
                <span className="infocard-ic is-wa"><WaIcon /></span>
                <span className="infocard-hd">WhatsApp</span>
                {/* The number itself as the thing you press: on a phone
                    this is one tap to a conversation, which is how most
                    of this shop's orders actually start. */}
                <span className="infocard-go">{settings.wa_number}</span>
                <small>{t("contactWaHint", lang)}</small>
                <Arrow />
              </a>
            )}

            {settings.hours && (
              <div className="infocard">
                <span className="infocard-ic is-blue"><ClockIcon /></span>
                <span className="infocard-hd">{t("aboutHours", lang)}</span>
                <p>{settings.hours}</p>
              </div>
            )}

            {hasPlace(place) && (
              <div className="infocard">
                <span className="infocard-ic is-blue"><PinIcon /></span>
                <span className="infocard-hd">{t("aboutWhere", lang)}</span>
                <p><MapLink parts={place} label={placeLine} /></p>
                {settings.pickup && <small>{t("aboutPickup", lang)}</small>}
                <Arrow />
              </div>
            )}
          </div>

          {/* The one question this page is most often opened to ask,
              answered by the screen that answers it properly rather than
              by a second copy of it here. */}
          <Link className="btn btn-ink infopage-cta" href="/track">
            <SendIcon />
            {t("navTrack", lang)}
            {/* A PLAIN ARROW, not the card one. <Arrow> is positioned
                absolutely for the corner of a .infocard, and this button
                is not one -- it flew to the top-right corner of the whole
                panel, which is the nearest positioned ancestor. */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </Link>
        </div>

        <StoreMark label={settings.store_name} />
      </section>
    </div>
  );
}

function Arrow() {
  return (
    <svg className="infocard-arw" width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
  );
}
function HeadsetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <path d="M4 14h3v5H5.5A1.5 1.5 0 0 1 4 17.5zM20 14h-3v5h1.5a1.5 1.5 0 0 0 1.5-1.5z" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0z" /><circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 3 10.5 13.5M21 3l-6.8 18-3.7-7.5L3 10.1z" />
    </svg>
  );
}
function WaIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 2a8 8 0 1 1-4.1 14.8l-.3-.2-2.6.7.7-2.5-.2-.3A8 8 0 0 1 12 4zm-3.2 4c-.2 0-.5.1-.7.4-.3.3-.9.9-.9 2.1 0 1.2.9 2.4 1 2.6.1.2 1.7 2.8 4.3 3.8 2.1.8 2.5.7 3 .6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.7-.4-1.4-.7c-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1-.2-.1-1-.4-1.9-1.2-.7-.6-1.2-1.4-1.3-1.6-.1-.2 0-.3.1-.4l.4-.5.3-.5v-.4l-.7-1.6c-.2-.4-.4-.4-.5-.4h-.1z" />
    </svg>
  );
}
