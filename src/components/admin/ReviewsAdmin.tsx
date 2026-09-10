"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import { deleteProductReview, deleteSellerRating } from "@/lib/actions/moderation";
import { nowIso, stars } from "@/lib/utils";
import { t } from "@/lib/i18n";
import WriteOnly from "./Access";
import type { AdminProductReview, AdminSellerRating } from "@/lib/data/admin";
import type { Lang } from "@/lib/types";

/** Long enough to judge a review by, short enough that one furious
 * paragraph does not push the next twenty off the screen. The full text
 * is on the product page, one click away. */
const PREVIEW = 300;

/** A rating far enough below the rest to be worth reading first.
 *
 * Not a filter and not a flag -- the list stays in the order things
 * arrived, because moderation is a "what has come in" job. This only
 * marks the rows most likely to be the reason somebody opened this
 * screen, so the eye reaches them without reading every line. */
const LOW_RATING = 2;

export default function ReviewsAdmin({
  lang, reviews, ratings, productNames, sellerNames,
}: {
  lang: Lang;
  reviews: AdminProductReview[];
  /** null when this account does not hold the Sellers section -- the
   * action refuses too, so this is about not drawing a list nobody here
   * can act on, not about the lock. */
  ratings: AdminSellerRating[] | null;
  productNames: Record<string, string>;
  sellerNames: Record<string, string>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  /* TWO CLICKS, NOT ONE, AND NO window.confirm().
   *
   * Removing what a customer wrote cannot be undone -- the row is gone
   * and only the audit trail remembers it -- so the button turns into a
   * question first. A native confirm() would do the same job and is the
   * one dialog in the app that cannot be translated, which on a
   * trilingual shop means an English browser prompt in the middle of a
   * Tetun screen. */
  async function remove(kind: "review" | "rating", id: string) {
    if (confirming !== id) { setConfirming(id); return; }
    setBusy(id);
    try {
      if (kind === "review") await deleteProductReview(id);
      else await deleteSellerRating(id);
      toast(t("reviewRemoved", lang));
      router.refresh();
    } catch (e) {
      toast((e as Error).message || t("reviewFailed", lang));
    }
    setBusy(null);
    setConfirming(null);
  }

  const row = (
    kind: "review" | "rating",
    id: string, rating: number, comment: string, when: string,
    about: string, aboutHref: string | null, who: string | null,
  ) => (
    <li key={id} className={"mod-row" + (rating <= LOW_RATING ? " is-low" : "")}>
      <div className="mod-head">
        <span className="mod-stars" title={`${rating} / 5`}>
          <span aria-hidden="true">{stars(rating)}</span>
          <span className="sr-only">{rating} / 5</span>
        </span>
        {aboutHref ? <Link href={aboutHref}>{about}</Link> : <b>{about}</b>}
        {who && <span className="sub">· {who}</span>}
        <time className="mod-when">{nowIso(when)}</time>
      </div>
      {comment.trim() ? (
        <p className="mod-text">{comment.slice(0, PREVIEW)}{comment.length > PREVIEW ? "…" : ""}</p>
      ) : (
        // A star rating with no words is normal and is not a moderation
        // problem; saying so beats an empty gap that reads as a bug.
        <p className="mod-text sub">{t("reviewNoComment", lang)}</p>
      )}
      <WriteOnly>
        <div className="mod-act">
          <button type="button" className="btn btn-sm btn-danger"
            disabled={busy === id} onClick={() => remove(kind, id)}>
            {busy === id ? "…" : confirming === id ? t("reviewConfirmRemove", lang) : t("remove", lang)}
          </button>
          {confirming === id && (
            <button type="button" className="btn btn-sm"
              onClick={() => setConfirming(null)}>{t("cancel", lang)}</button>
          )}
        </div>
      </WriteOnly>
    </li>
  );

  return (
    <>
      <div className="panel">
        <h1>{t("reviewsAdmin", lang)}</h1>
        <p className="sub">{t("reviewsAdminHint", lang)}</p>

        <h2>{t("productReviews", lang)}</h2>
        {reviews.length === 0 ? (
          <p className="sub">{t("noReviewsYet", lang)}</p>
        ) : (
          <ul className="mod-list">
            {reviews.map((r) => row(
              "review", r.id, r.rating, r.comment, r.created_at,
              productNames[r.product_id] || t("productRemoved", lang),
              productNames[r.product_id] ? `/admin/p/${r.product_id}` : null,
              r.buyer_name || null,
            ))}
          </ul>
        )}
      </div>

      {ratings && (
        <div className="panel">
          <h2>{t("sellerRatings", lang)}</h2>
          {ratings.length === 0 ? (
            <p className="sub">{t("noReviewsYet", lang)}</p>
          ) : (
            <ul className="mod-list">
              {ratings.map((r) => row(
                "rating", r.id, r.rating, r.comment, r.created_at,
                sellerNames[r.seller_id] || t("sellerRemoved", lang),
                null, null,
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
