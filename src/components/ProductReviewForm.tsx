"use client";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { submitProductReview } from "@/lib/actions/reviews";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/** Shown on the order-tracking page once an order is completed, one per
 * distinct product in it. Authorization reuses the ref+phone the buyer
 * already proved to see this page at all — submitProductReview re-checks
 * both server-side, plus that the order really contained this product, so
 * nothing here is load-bearing for trust. */
export default function ProductReviewForm({
  lang, orderRef, phone, productId, productName,
}: { lang: Lang; orderRef: string; phone: string; productId: string; productName: string }) {
  const { toast } = useToast();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!rating) {
      toast(t("chooseRating", lang), true);
      return;
    }
    setBusy(true);
    try {
      await submitProductReview({ ref: orderRef, phone, productId, rating, comment });
      setDone(true);
      toast(t("reviewSaved", lang));
    } catch (e) {
      toast(String((e as Error).message), true);
    }
    setBusy(false);
  }

  if (done) {
    return <p className="sub">{t("reviewSaved", lang)} — {productName}</p>;
  }

  return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10 }}>
      <p className="sub" style={{ margin: "0 0 6px" }}>{t("rateProduct", lang)} {productName}</p>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n} type="button" onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)}
            style={{
              border: 0, background: "none", cursor: "pointer", fontSize: 24, lineHeight: 1, padding: 2,
              color: (hover || rating) >= n ? "var(--amber-ink)" : "var(--line)",
            }}
            aria-label={`${n} star`}
          >
            ★
          </button>
        ))}
      </div>
      <div className="field" style={{ marginBottom: 8 }}>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)}
          placeholder={t("reviewCommentPlaceholder", lang)} />
      </div>
      <button className="btn btn-sm btn-amber" type="button" disabled={busy} onClick={submit}>
        {busy ? "…" : t("submitReview", lang)}
      </button>
    </div>
  );
}
