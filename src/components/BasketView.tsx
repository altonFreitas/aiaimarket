"use client";
import Link from "next/link";
import Image from "next/image";
import { useBasket } from "@/lib/useBasket";
import { useBasketStock } from "@/lib/useBasketStock";
import { deliveryNote } from "@/lib/payMethods";
import { placeholder } from "@/lib/placeholder";
import { zoneLabelKey } from "@/lib/zones";
import QtyStepper from "./QtyStepper";
import EmptyBasketArt from "./EmptyBasketArt";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Lang, Product, Settings } from "@/lib/types";

/* THE CART, ON THE REFERENCE'S SHAPE.
 *
 * The reference is a slide-over sheet: suggested products down the left,
 * the line items beside them, a shipping banner, then shipping, total,
 * checkout and a row of card logos.
 *
 * Two of those cannot be told the truth here and are done differently:
 *
 *   "Free shipping on orders over $50" -- there is no such threshold and
 *   no setting that could hold one. Delivery is priced by ZONE and which
 *   zone is a question the CHECKOUT asks. So the banner says what is
 *   actually on offer: the zone that costs nothing, if there is one, or
 *   what delivery starts at if there is not. See deliveryNote().
 *
 *   "Shipping $9.99" above the total -- the cart does not know the zone,
 *   so it does not know the fee. It shows the subtotal and says delivery
 *   is added at checkout, rather than printing a total that is about to
 *   change. A cart that quotes a total it cannot honour is the one thing
 *   worse than a cart that asks you to go one screen further.
 *
 * The card logos are the payment methods this shop has switched on, named
 * rather than drawn -- the same list the footer prints, from
 * lib/payMethods.ts.
 */
export default function BasketView({
  lang, settings, suggestions, pays,
}: {
  lang: Lang;
  settings: Settings;
  suggestions: Product[];
  pays: string[];
}) {
  const { lines, ready, setQty, remove, subtotal, applyStock } = useBasket();
  /* What the shelf holds NOW, not when the line was added -- see
     useBasketStock. */
  useBasketStock(lines, ready, applyStock);

  // Nothing is known about the basket until the browser's copy has been
  // read. Saying "empty" here would be saying it about a basket nobody has
  // looked in yet -- which is exactly what a shopper saw flash over their
  // order every time they came back to this page. The heading is the same
  // either way, so showing it alone costs no layout jump.
  if (!ready) {
    return (
      <div className="wrap" aria-busy="true">
        <h1>{t("list", lang)}</h1>
      </div>
    );
  }

  if (!lines.length) {
    return (
      <div className="wrap">
        <h1>{t("list", lang)}</h1>
        <div className="empty">
          <p>{t("emptyList", lang)}</p>
          <Link className="btn" href="/">{t("browse", lang)}</Link>
          {/* Under the button, deliberately: the way out of an empty basket
              is the thing to reach first, and the drawing is what you look
              at while deciding to. */}
          <EmptyBasketArt />
        </div>
      </div>
    );
  }

  const note = deliveryNote(settings.zones ?? [], (id) => t(zoneLabelKey(id), lang));

  /* Nothing already in the basket. Suggesting what somebody has just put
     in their cart is the clearest way to look like a machine. */
  const inBasket = new Set(lines.map((l) => l.id));
  const suggest = suggestions.filter((p) => !inBasket.has(p.id)).slice(0, 4);

  // Group by seller only when it's actually useful -- a single-seller
  // basket (the overwhelmingly common case: everything from the
  // platform's own catalog) just renders as one flat list. Items keep
  // their real index in `lines` (needed for setQty/remove), just
  // reordered visually by group.
  const withIndex = lines.map((l, i) => ({ l, i }));
  const groupKey = (sellerId: string | null | undefined) => sellerId || "__platform__";
  const sellerIds = Array.from(new Set(withIndex.map(({ l }) => groupKey(l.seller_id))));
  const multiSeller = sellerIds.length > 1;
  const groups = multiSeller
    ? sellerIds.map((key) => ({
        key,
        // seller_id is never actually null (it defaults to the platform
        // owner's own id) -- the platform owner also just never has a row
        // in `sellers`, so `sellerName` comes back empty only for their
        // own products. That is the real signal here.
        sellerName: withIndex.find(({ l }) => groupKey(l.seller_id) === key)?.l.sellerName || null,
        items: withIndex.filter(({ l }) => groupKey(l.seller_id) === key),
      }))
    : [{ key: "__all__", sellerName: null, items: withIndex }];

  return (
    <div className="wrap cart-wrap">
      <h1>{t("list", lang)}</h1>

      <div className="cart-cols">
        {/* ---- the lines ------------------------------------------- */}
        <div className="cart-main">
          {note && (
            <div className="cart-note">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" />
                <circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" />
              </svg>
              <span>
                {t(note.key, lang)
                  .replace("{zone}", note.vars.zone ?? "")
                  .replace("{fee}", money(Number(note.vars.fee ?? 0)))}
              </span>
            </div>
          )}

          {groups.map((g) => (
            <div key={g.key}>
              {multiSeller && (
                <p className="hint cart-seller">
                  {g.sellerName ? `${t("soldBy", lang)} ${g.sellerName}` : settings.store_name}
                </p>
              )}
              {g.items.map(({ l, i }) => (
                <div className="cart-line" key={`${l.id}-${l.size}-${i}`}>
                  {l.slug ? (
                    <Link href={`/p/${l.slug}`} className="cart-thumb">
                      <Image src={l.image || placeholder(l.name)} alt="" width={72} height={72} />
                    </Link>
                  ) : (
                    <span className="cart-thumb">
                      <Image src={l.image || placeholder(l.name)} alt="" width={72} height={72} />
                    </span>
                  )}

                  <div className="cart-line-body">
                    <div className="cart-line-top">
                      <div>
                        {l.slug
                          ? <Link className="cart-name" href={`/p/${l.slug}`}>{l.name}</Link>
                          : <b className="cart-name">{l.name}</b>}
                        {l.size && <span className="hint"> · {l.size}</span>}
                      </div>
                      <button className="cart-x" type="button" onClick={() => remove(i)}
                        aria-label={t("remove", lang)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                        </svg>
                      </button>
                    </div>
                    <div className="cart-line-bottom">
                      <QtyStepper line={l} lang={lang} height={32} onChange={(q) => setQty(i, q)} />
                      <div className="cart-money">
                        <b>{money(l.price * l.qty)}</b>
                        {/* Only when it adds something. "$12.00 each" under
                            "$12.00" is the same number twice. */}
                        {l.qty > 1 && (
                          <span className="hint">{money(l.price)} {t("each", lang)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}

          {/* ---- totals -------------------------------------------- */}
          <div className="cart-sum">
            <div className="kv"><span>{t("subtotal", lang)}</span><b>{money(subtotal)}</b></div>
            {/* NOT A TOTAL. The zone decides the fee and the zone is chosen
                one screen along, so this says where the rest of the number
                comes from instead of inventing it. */}
            <div className="kv">
              <span>{t("deliveryFee", lang)}</span>
              <span className="hint">{t("cartDeliveryAtCheckout", lang)}</span>
            </div>
            <Link className="btn cart-go" href="/checkout">{t("checkout", lang)}</Link>
            <Link className="btn btn-ghost" href="/">{t("browse", lang)}</Link>
            <div className="cart-pays">
              {pays.map((k) => <span className="ft-pay" key={k}>{t(k, lang)}</span>)}
            </div>
          </div>
        </div>

        {/* ---- suggestions ----------------------------------------- */}
        {suggest.length > 0 && (
          <aside className="cart-side" aria-labelledby="cart-sugg">
            <h2 id="cart-sugg">{t("cartSuggested", lang)}</h2>
            <div className="cart-sugg">
              {suggest.map((p) => (
                <Link key={p.id} className="cart-sugg-item" href={`/p/${p.slug}`}>
                  <Image src={p.images?.[0] || placeholder(p.name)} alt=""
                    width={120} height={120} />
                  <span className="cart-sugg-name">{p.name}</span>
                  <b>{money(p.discount_price ?? p.price)}</b>
                </Link>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
