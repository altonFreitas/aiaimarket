import { nowIso, ratingAverage, stars } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Lang, Product, ProductReview } from "@/lib/types";

/** Review list for one product page.
 *
 * The summary line reads the denormalised counters on the product row, not
 * the `reviews` array: the array is capped at the most recent 20, so
 * averaging it would quietly disagree with the star rating on the same
 * product's card once a product passes 20 reviews. */
export default function ProductReviews({
  p, reviews, lang,
}: { p: Product; reviews: ProductReview[]; lang: Lang }) {
  const average = ratingAverage(p);
  const count = Number(p.rating_count) || 0;

  return (
    <div className="panel" style={{ marginTop: 12 }} id="reviews">
      <h3>{t("productReviews", lang)}</h3>

      {average == null ? (
        <p className="sub" style={{ margin: 0 }}>{t("noReviewsYet", lang)}</p>
      ) : (
        <>
          <p className="review-summary">
            <span className="review-stars" aria-hidden="true">{stars(average)}</span>
            <b>{average.toFixed(1)}</b>
            <span className="sub" style={{ margin: 0 }}>
              {count} {t("reviewCount", lang)}
            </span>
          </p>

          {reviews.map((r) => (
            <div key={r.id} className="review">
              <div className="review-head">
                <span className="review-stars" aria-hidden="true">{stars(r.rating)}</span>
                <span className="sr">{r.rating} / 5</span>
                {/* Every review in this table came through submitProductReview,
                    which verifies the order before writing -- so the badge is
                    a fact about the data, not a claim the reviewer made. */}
                <span className="pill ok">{t("verifiedPurchase", lang)}</span>
              </div>
              {r.comment && <p className="review-body">{r.comment}</p>}
              <p className="hint" style={{ margin: "4px 0 0" }}>
                {r.buyer_name ? `${r.buyer_name} · ` : ""}{nowIso(r.created_at)}
              </p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
