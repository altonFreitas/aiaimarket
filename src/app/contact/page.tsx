import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/data/public";
import { getLang } from "@/lib/lang";
import { localeMetadata } from "@/lib/locale";
import MapLink, { hasPlace } from "@/components/MapLink";
import { waLink, waNumberDigits } from "@/lib/utils";
import { t } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const [lang, settings] = await Promise.all([getLang(), getSettings()]);
  return {
    title: `${t("contactTitle", lang)} — ${settings.store_name}`,
    ...localeMetadata(lang, "/contact"),
  };
}

/** HOW TO REACH THE SHOP.
 *
 * WhatsApp first, and deliberately: it is how this shop already takes
 * orders -- every product page has an "Order via WhatsApp" button on it --
 * so a contact page that led with an email form would be offering a
 * slower channel than the one the shop actually answers.
 *
 * NO CONTACT FORM. A form needs somewhere to deliver to, and this shop has
 * no mail transport configured; a box that swallows a message and says
 * "thank you" is worse than no box. Everything here is a channel that
 * demonstrably works, drawn from Settings.
 */
export default async function ContactPage() {
  const [lang, settings] = await Promise.all([getLang(), getSettings()]);
  const place = [settings.landmark, settings.suku, settings.post, settings.municipality];
  const placeLine = place.filter(Boolean).join(", ");

  return (
    <div className="wrap prose-page">
      <h1>{t("contactTitle", lang)}</h1>
      <p className="lede">{settings.store_name}</p>

      <div className="about-grid">
        {settings.wa_number && (
          <section className="panel">
            <h3>WhatsApp</h3>
            <p>
              <a className="btn btn-wa" href={waLink(waNumberDigits(settings), t("contactWaGreeting", lang))}
                target="_blank" rel="noopener">
                {settings.wa_number}
              </a>
            </p>
            <p className="hint">{t("contactWaHint", lang)}</p>
          </section>
        )}

        {settings.hours && (
          <section className="panel">
            <h3>{t("aboutHours", lang)}</h3>
            <p>{settings.hours}</p>
          </section>
        )}

        {hasPlace(place) && (
          <section className="panel">
            <h3>{t("aboutWhere", lang)}</h3>
            <p><MapLink parts={place} label={placeLine} /></p>
          </section>
        )}
      </div>

      {/* The one question this page is most often opened to ask, answered
          by sending them to the screen that answers it properly rather
          than by a second copy of it here. */}
      <p>
        <Link className="btn" href="/track">{t("navTrack", lang)}</Link>
      </p>
    </div>
  );
}
