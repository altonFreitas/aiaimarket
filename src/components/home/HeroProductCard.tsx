"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { placeholder } from "@/lib/placeholder";
import { money, discountPercent, ratingAverage, stars } from "@/lib/utils";
import { useLoves } from "@/lib/useLoves";
import { toggleLoveAction } from "@/lib/actions/loves";
import HeartIcon from "@/components/HeartIcon";
import { t } from "@/lib/i18n";
import type { HeroFeature } from "@/lib/heroFeature";
import type { Lang } from "@/lib/types";

/** The same three stock badges the grid cards use. Restating the map here
 * rather than importing it from ProductCard is deliberate: exporting it
 * would make a grid-card detail part of that component's public surface,
 * and it is three pairs of strings. The GUARD is that both render the same
 * i18n keys -- see tests/heroCarousel. */
const BADGE = { in: ["b-in", "stockIn"], low: ["b-low", "stockLow"], out: ["b-out", "stockOut"] } as const;

/* THE PRODUCT CARD THAT SITS ON THE HERO.
 *
 * The reference puts a rich card over the full-bleed picture: a big photo
 * with a badge and a wishlist heart, a gallery under the pointer, then the
 * category, the name, the price and a star rating with a review count.
 *
 * Every one of those is READ FROM THE PRODUCT. The reference card says
 * "5.8K REVIEWS" beside five filled stars, and that is the one thing not
 * copied: this shop shows the rating it actually has, and shows NOTHING
 * where a product has never been reviewed -- not five empty stars, not
 * "0 reviews", which both read as a verdict rather than as silence. Same
 * rule the grid card has always followed.
 *
 * The whole card is one link to the product. The reference's "Quick View"
 * is a modal of the product page; this shop already has a product page,
 * and a second copy of it that can drift is worse than one more tap.
 */
export default function HeroProductCard({
  feature, lang,
}: { feature: HeroFeature; lang: Lang }) {
  const { product: p, categoryName } = feature;
  const [shot, setShot] = useState(0);

  const images = (p.images || []).filter(Boolean);
  const gallery = images.length ? images : [placeholder(p.name)];
  const img = gallery[Math.min(shot, gallery.length - 1)];

  const [cls, key] = BADGE[p.stock_status];
  const pct = discountPercent(p.price, p.discount_price);
  /* Denormalised onto the product row by a trigger, so this costs no
     query. null on a product nobody has reviewed AND on a database
     without the migration -- both mean "say nothing". */
  const rating = ratingAverage(p);
  const reviews = Number(p.rating_count) || 0;

  const { has, toggle, ready } = useLoves();
  const loved = ready && has(p.id);

  function toggleLove(e: React.MouseEvent) {
    // The card is a link; the heart is not a way of following it.
    e.preventDefault();
    e.stopPropagation();
    const nowLoved = !loved;
    toggle(p.id);
    void toggleLoveAction(p.id, nowLoved);
  }

  return (
    <Link className="hpc" href={`/p/${p.slug}`}>
      <div className="hpc-ph">
        <Image src={img} alt="" width={640} height={640} sizes="(max-width:700px) 60vw, 300px"
          unoptimized={img.startsWith("data:")} />

        <div className="hpc-top">
          <span className={"badge " + cls}>{t(key, lang)}</span>
          {pct != null && <span className="hpc-off">−{pct}%</span>}
        </div>

        <button type="button" className={"hpc-love" + (loved ? " is-on" : "")}
          onClick={toggleLove} aria-pressed={loved}
          aria-label={`${t(loved ? "unlove" : "love", lang)} — ${p.name}`}>
          <HeartIcon size={18} filled={loved} rimmed />
        </button>

        {/* THE GALLERY, ONLY WHEN THERE IS ONE.
            A single dot under a single photo is a control that does
            nothing. Buttons rather than hover, because the pointer is not
            the only way people use this and a phone has no hover at all. */}
        {gallery.length > 1 && (
          <div className="hpc-shots">
            {gallery.slice(0, 5).map((src, idx) => (
              <button key={src + idx} type="button"
                className={"hpc-shot" + (idx === shot ? " on" : "")}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShot(idx); }}
                aria-label={`${t("heroShot", lang)} ${idx + 1}`} />
            ))}
          </div>
        )}
      </div>

      <div className="hpc-body">
        {categoryName && <span className="hpc-cat">{categoryName}</span>}
        <div className="hpc-line">
          <b className="hpc-name">{p.name}</b>
          <span className="hpc-price">
            {p.discount_price ? (
              <>
                <b>{money(Number(p.discount_price))}</b>
                <s>{money(Number(p.price))}</s>
              </>
            ) : (
              <b>{money(Number(p.price))}</b>
            )}
          </span>
        </div>
        {rating != null && (
          <div className="hpc-rate">
            <span className="hpc-stars" aria-hidden="true">{stars(rating)}</span>
            <span>{rating.toFixed(1)}</span>
            {/* The count, in the reference's place -- but only the real
                one, and never rounded up into a "5.8K" nobody earned. */}
            <span className="hpc-reviews">
              {t(reviews === 1 ? "heroReview1" : "heroReviews", lang)
                .replace("{n}", String(reviews))}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}
