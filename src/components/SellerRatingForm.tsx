"use client";
import { useState } from "react";
import { useToast } from "@/components/Toast";
import { submitSellerRating } from "@/lib/actions/ratings";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

/** Shown on the order-tracking page once an order is completed — same
 * ref+phone the buyer already proved ownership of to see this page in
 * the first place is reused server-side to authorize the rating (see
 * submitSellerRating), so there's no separate login for this. */
export default function SellerRatingForm({
  lang, orderRef, phone, sellerId, sellerName,
}: { lang: Lang; orderRef: string; phone: string; sellerId: string; sellerName: string }) {
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
      await submitSellerRating({ ref: orderRef, phone, sellerId, rating, comment });
      setDone(true);
      toast(t("ratingSaved", lang));
    } catch (e) {
      toast(String((e as Error).message), true);
    }
    setBusy(false);
  }

  if (done) {
    return <p className="sub">{t("ratingSaved", lang)} — {sellerName}</p>;
  }

  return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10 }}>
      <p className="sub" style={{ margin: "0 0 6px" }}>{t("rateSeller", lang)} {sellerName}</p>
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
          placeholder={t("ratingCommentPlaceholder", lang)} />
      </div>
      <button className="btn btn-sm btn-amber" type="button" disabled={busy} onClick={submit}>
        {busy ? "…" : t("submitRating", lang)}
      </button>
    </div>
  );
}
