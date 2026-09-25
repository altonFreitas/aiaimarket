import Link from "next/link";
import Image from "next/image";
import { placeholder } from "@/lib/placeholder";
import { t } from "@/lib/i18n";
import type { Testimonial } from "@/lib/data/public";
import type { Lang } from "@/lib/types";

/* WHAT SHOPPERS HAVE SAID.
 *
 * Real rows out of product_reviews -- see getTestimonials for why none of
 * this is written. Which means the section has to survive being empty,
 * being one, and being nine, so it is a grid that reflows rather than a
 * carousel that needs three to look right.
 *
 * EACH ONE CARRIES WHAT IT IS ABOUT. A quote with a product beside it is
 * checkable; a quote on its own is a sentence in quotation marks. The
 * thumbnail links to the thing being praised, which is also the most
 * useful place a reader of a good review could possibly be sent.
 */
export default function Testimonials({
  items, lang,
}: {
  items: Testimonial[];
  lang: Lang;
}) {
  if (!items.length) return null;

  return (
    <section className="home-section" id="testimonials">
      <div className="home-section-hd">
        <div>
          <h2>{t("testimonials", lang)}</h2>
          <p className="home-section-sub">{t("testimonialsSub", lang)}</p>
        </div>
      </div>

      <div className="tmls">
        {items.map((r) => (
          <figure key={r.id} className="tml">
            <div className="tml-stars" aria-label={`${r.rating} / 5`}>
              <span aria-hidden="true">
                {"★★★★★".slice(0, Math.round(r.rating))}
                <span className="stars-off">{"★★★★★".slice(Math.round(r.rating))}</span>
              </span>
            </div>
            {/* The words, and nothing done to them. A review trimmed to fit
                is a review the shop edited. It is capped by line height
                instead, so a long one is cut visibly rather than quietly. */}
            <blockquote className="tml-q">{r.comment}</blockquote>
            <figcaption className="tml-by">
              <b>{r.buyer_name || t("aCustomer", lang)}</b>
              {r.product && (
                <Link className="tml-p" href={`/p/${r.product.slug}`}>
                  <Image
                    src={r.product.image || placeholder(r.product.name)}
                    alt="" width={72} height={72} loading="lazy" sizes="36px"
                    unoptimized={(r.product.image || "x").startsWith("data:") || !r.product.image}
                  />
                  <span>{r.product.name}</span>
                </Link>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
