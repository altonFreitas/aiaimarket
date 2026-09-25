import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/data/public";
import { getLang } from "@/lib/lang";
import { localeMetadata } from "@/lib/locale";
import MapLink, { hasPlace } from "@/components/MapLink";
import { taglineOf } from "@/lib/tagline";
import { t } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const [lang, settings] = await Promise.all([getLang(), getSettings()]);
  return {
    title: `${t("aboutTitle", lang)} — ${settings.store_name}`,
    ...localeMetadata(lang, "/about"),
  };
}

/** WHO THE SHOP IS.
 *
 * The header's nav names this page, so it has to exist -- a nav link to a
 * 404 on every page of the site is worse than a nav with one fewer item.
 *
 * EVERY WORD OF IT IS THE SHOP'S OWN. The store name, the tagline in the
 * reader's language, the opening hours and the address all come from
 * Settings, which is where the owner already maintains them. Nothing here
 * is written copy that would go stale the first time the shop moved, and
 * there is no "our story" paragraph invented on the shop's behalf.
 *
 * Each block disappears when its setting is blank, so a shop that has
 * filled in three of five things shows three, rather than three facts and
 * two empty headings.
 */
export default async function AboutPage() {
  const [lang, settings] = await Promise.all([getLang(), getSettings()]);
  const place = [settings.landmark, settings.suku, settings.post, settings.municipality];
  const line = taglineOf(settings, lang);
  /** The address as one readable line -- the pin needs something to say
   *  beside it, and the parts are stored separately. */
  const placeLine = (parts: (string | null)[]) => parts.filter(Boolean).join(", ");

  return (
    <div className="wrap prose-page">
      <h1>{t("aboutTitle", lang)}</h1>
      <p className="lede">{settings.store_name}</p>
      {line && <p>{line}</p>}

      <div className="about-grid">
        {settings.hours && (
          <section className="panel">
            <h3>{t("aboutHours", lang)}</h3>
            <p>{settings.hours}</p>
          </section>
        )}

        {hasPlace(place) && (
          <section className="panel">
            <h3>{t("aboutWhere", lang)}</h3>
            <p><MapLink parts={place} label={placeLine(place)} /></p>
            {settings.pickup && <p className="hint">{t("aboutPickup", lang)}</p>}
          </section>
        )}

        {settings.legal_registration && (
          <section className="panel">
            <h3>{t("aboutRegistered", lang)}</h3>
            <p className="mono">{settings.legal_registration}</p>
            {settings.legal_address && <p>{settings.legal_address}</p>}
          </section>
        )}
      </div>

      <p>
        {/* Where the rest of it is, rather than restating any of it here
            -- two copies of a returns window is one that will be wrong. */}
        <Link href="/contact">{t("contactTitle", lang)}</Link>
        {" · "}
        <Link href="/legal/terms">{t("termsPrivacyTitle", lang)}</Link>
        {" · "}
        <Link href="/legal/returns">{t("returnsTitle", lang)}</Link>
      </p>
    </div>
  );
}
