import Link from "next/link";
import { getCategories } from "@/lib/data/public";
import { cardPaymentAvailable } from "@/lib/payments/registry";
import { t } from "@/lib/i18n";
import { taglineOf } from "@/lib/tagline";
import { money, waLink, waNumberDigits } from "@/lib/utils";
import { zoneLabelKey } from "@/lib/zones";
import type { Lang, Settings } from "@/lib/types";
import Image from "next/image";
import MapLink from "./MapLink";

/* THE FOOTER, ON THE REFERENCE'S SHAPE AND THIS SHOP'S FACTS.
 *
 * The reference is a large ecommerce footer: a row of four boutiques
 * across the top, then a brand column with social icons, three columns of
 * links, an "app on the go" panel, and a strip of card-network logos along
 * the bottom.
 *
 * This shop has ONE address, no app, no social accounts in its settings,
 * and does not take cards unless somebody has configured a gateway. Copying
 * the reference literally would put four boutiques, two app stores and six
 * card brands on a site where none of them exist -- and a footer is exactly
 * where a shopper goes to check whether a shop is real.
 *
 * So the SHAPE is the reference's and every fact in it comes from the
 * settings:
 *
 *   the four-across row of stores  ->  where this shop actually is, and
 *                                      the delivery zones it actually
 *                                      reaches, with the fee each one
 *                                      costs;
 *   Collections                    ->  the categories in the database;
 *   Shop On The Go / app badges    ->  WhatsApp, which is this shop's real
 *                                      channel and the one thing every
 *                                      customer already has;
 *   Follow Us / social icons       ->  omitted. There is nowhere to
 *                                      follow. An icon linking to a
 *                                      Facebook page that does not exist
 *                                      is worse than no icon;
 *   the card-network strip         ->  the payment methods this shop has
 *                                      switched on, named in the shopper's
 *                                      language.
 *
 * Every section below disappears rather than emptying: a shop with no
 * categories yet shows no Collections column, not a heading over nothing.
 */
export default async function Footer(
  { settings, lang }: { settings: Settings; lang: Lang }
) {
  const cats = await getCategories().catch(() => []);
  /* Top level only, and a handful. The reference's column is four links
     long; a shop with forty categories would otherwise print forty. */
  const top = cats.filter((c) => !c.parent_id).slice(0, 6);

  const wa = waNumberDigits(settings);
  const tagline = taglineOf(settings, lang);

  /* WHERE THIS SHOP REACHES. A zone that quotes rather than charging a
     fixed fee says so instead of printing a price it does not have -- the
     same rule the checkout follows. */
  const zones = (settings.zones ?? []).filter((z) => z && z.id);

  /* WHAT IT ACTUALLY TAKES. Read off the settings, not a list of logos:
     bank transfer only when a bank has been entered, a wallet only when
     one has, a card only when a gateway is configured. */
  const pays: string[] = [];
  pays.push("pm_cod");
  if (settings.pickup) pays.push("pm_cop");
  if ((settings.banks ?? []).length) pays.push("pm_bank");
  if ((settings.wallets ?? []).length) pays.push("pm_wallet");
  if (cardPaymentAvailable()) pays.push("pm_card");

  return (
    <footer className="ft">
      {/* ---- Where to find us, and where we deliver ------------------- */}
      <div className="ft-places">
        <div className="ft-place">
          <b>{settings.store_name}</b>
          <MapLink
            parts={[settings.landmark, settings.suku, settings.municipality, "Timor-Leste"]}
            label={[settings.suku, settings.municipality].filter(Boolean).join(", ")} />
          {settings.hours && <span className="ft-dim">{settings.hours}</span>}
        </div>
        {zones.map((z) => (
          <div className="ft-place" key={z.id}>
            <b>{t(zoneLabelKey(z.id), lang)}</b>
            <span className="ft-dim">
              {/* A zone that is quoted case by case must not print a fee.
                  Saying "$0.00" of a delivery somebody will be charged for
                  is the one thing this line must never do. */}
              {/* The same wording the checkout's zone picker uses, so a
                  shopper meets one phrase for one thing. */}
              {z.quote ? t("quoteOnRequest", lang)
                       : t("deliveryFee", lang) + " " + money(z.fee)}
            </span>
          </div>
        ))}
      </div>

      <hr className="ft-rule" />

      {/* ---- Brand, links, and the way to talk to the shop ------------ */}
      <div className="ft-main">
        <div className="ft-brand">
          {/* The same mark the header carries, at the same treatment.
              StoreMark is the big decorative panel the About page uses and
              would be a photograph-sized block here. */}
          <div className="ft-mark">
            <Image src="/logo-mark.webp" alt="" width={280} height={115}
              style={{ height: 20, width: "auto" }} />
            <b>{settings.store_name}</b>
          </div>
          {tagline && <p className="ft-dim">{tagline}</p>}
        </div>

        {top.length > 0 && (
          <nav className="ft-col" aria-labelledby="ft-cats">
            <h3 id="ft-cats">{t("categories", lang)}</h3>
            {top.map((c) => (
              <Link key={c.id} href={`/c/${c.slug}`}>{c.name}</Link>
            ))}
          </nav>
        )}

        <nav className="ft-col" aria-labelledby="ft-help">
          <h3 id="ft-help">{t("help", lang)}</h3>
          <Link href="/contact">{t("navContact", lang)}</Link>
          <Link href="/track">{t("navTrack", lang)}</Link>
          <Link href="/legal/returns">{t("returnsTitle", lang)}</Link>
        </nav>

        <nav className="ft-col" aria-labelledby="ft-info">
          <h3 id="ft-info">{t("information", lang)}</h3>
          <Link href="/about">{t("navAbout", lang)}</Link>
          {/* Terms and privacy are one page (see legal/terms): two links
              at one document just makes the footer look like it repeats. */}
          <Link href="/legal/terms">{t("termsPrivacyTitle", lang)}</Link>
        </nav>

        {/* The reference's app panel. There is no app; there is a number
            everybody already has. */}
        {wa && (
          <div className="ft-col ft-wa">
            <h3>{t("footWaTitle", lang)}</h3>
            <p className="ft-dim">{t("footWaBody", lang)}</p>
            {/* btn-wa, which is WhatsApp's own green -- darkened exactly as
                far as white text needs to stay legible on it, and no
                further. tests/contrast.test.ts holds it there: the brand
                #25D366 measures 2.2:1 against white, which is a label
                somebody has to squint at. */}
            <a className="btn btn-sm btn-wa" target="_blank" rel="noopener"
              href={waLink(wa, t("footWaMsg", lang))}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"
                aria-hidden="true">
                <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2zm5.8 14.2c-.2.7-1.4 1.3-2 1.4-.5.1-1.1.1-1.8-.1a15 15 0 0 1-6.6-5.6c-.5-.7-.9-1.6-.9-2.4 0-.9.5-1.4.7-1.6.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c0 .2 0 .4-.1.5l-.4.5c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.1 1 2 1.3 2.3 1.4.2.1.4.1.6-.1l.7-.8c.2-.2.3-.2.5-.1l1.8.9c.2.1.4.2.4.3.1.1.1.5 0 .9z" />
              </svg>
              {t("orderWa", lang)}
            </a>
          </div>
        )}
      </div>

      <hr className="ft-rule" />

      {/* ---- Copyright, and what the shop takes ----------------------- */}
      <div className="ft-bottom">
        <span className="ft-dim">
          © {new Date().getFullYear()} {settings.store_name}
        </span>
        <span className="ft-pays">
          {pays.map((k) => (
            <span className="ft-pay" key={k}>{t(k, lang)}</span>
          ))}
        </span>
      </div>
    </footer>
  );
}
