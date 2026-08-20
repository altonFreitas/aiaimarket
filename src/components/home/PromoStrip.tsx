import Link from "next/link";
import Image from "next/image";
import { t } from "@/lib/i18n";
import type { Lang, Promotion } from "@/lib/types";

/** Homepage row of colourful promo tiles — the "Oportunidades aos melhores
 * preços" pattern: a horizontal strip of image cards, each with an optional
 * deal badge, linking straight into the catalog. Purely a merchandising
 * shortcut on top of the existing catalog (see lib/actions/promotions.ts) —
 * it creates no new product data, just faster paths into what's already
 * there. Renders nothing when the admin hasn't added any tiles yet, same
 * "don't show an empty section" rule as every other home-page block. */
export default function PromoStrip({ lang, promotions }: { lang: Lang; promotions: Promotion[] }) {
  if (!promotions.length) return null;
  return (
    <section className="promo-strip" aria-label={t("dealsTitle", lang)}>
      <h2 className="promo-strip-title">{t("dealsTitle", lang)}</h2>
      <div className="promo-strip-row">
        {promotions.map((p) => (
          <Link key={p.id} href={p.href} className="promo-tile">
            {p.badge_label && <span className="promo-tile-badge">{p.badge_label}</span>}
            <Image
              src={p.image_url}
              alt=""
              width={220}
              height={140}
              sizes="(max-width: 700px) 45vw, 220px"
              unoptimized={p.image_url.startsWith("data:")}
            />
            <span className="promo-tile-title">{p.title}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
