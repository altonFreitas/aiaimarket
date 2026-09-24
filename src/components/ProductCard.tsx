"use client";
import type { MouseEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { placeholder } from "@/lib/placeholder";
import {money,discountPercent, ratingAverage, stars} from "@/lib/utils";
import CartIcon from "./CartIcon";
import { t } from "@/lib/i18n";
import { useBasket } from "@/lib/useBasket";
import { useLoves } from "@/lib/useLoves";
import { toggleLoveAction } from "@/lib/actions/loves";
import { useToast } from "@/components/Toast";
import type { Product } from "@/lib/types";
import type { Lang } from "@/lib/types";

const BADGE = { in: ["b-in", "stockIn"], low: ["b-low", "stockLow"], out: ["b-out", "stockOut"] } as const;

/* The heart, as a square turned on its point with a lobe on each shoulder:
 * the tip at (12, 21.23), the notch at (12, 5.67), and the two extremes at
 * x=3.16 and x=20.84 -- 8.84 either side of the centre line, so it is
 * symmetrical. The one before it was drawn by hand, leaned right, and at
 * this size read as a smudge rather than a heart. */
const HEART = "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";

export default function ProductCard(
  { p, lang, sellerName, flag }:
  { p: Product; lang: Lang; sellerName?: string; flag?: string },
) {
  const [cls, key] = BADGE[p.stock_status];
  const img = p.images?.[0] || placeholder(p.name);
  const loc = p.suku || p.municipality || "";
  const pct = discountPercent(p.price, p.discount_price);
  // Comes straight off the product row (denormalised by a trigger, see
  // marketplace-v2.sql), so a 24-card grid costs no extra queries. null on a
  // database without the migration, and on a product nobody has reviewed --
  // both render as "no rating shown", never as zero stars.
  const rating = ratingAverage(p);
  const { add } = useBasket();
  const { has, toggle, ready: lovesReady } = useLoves();
  const { toast } = useToast();
  const loved = lovesReady && has(p.id);

  /* A PRODUCT SOLD IN SIZES CANNOT BE BOUGHT FROM A GRID.
     This button used to add p.sizes[0] -- so a shoe listed in 40, 41 and
     42 went into the basket as a 40 because that is the order somebody
     typed the sizes in. The shopper chose nothing, the shop got an order
     for a size nobody asked for, and the shelf could run out of 40 while
     41 and 42 sat there.

     The product page has always refused this -- it says "Choose a size"
     and stops -- so the same product behaved differently depending on
     which of the two buttons was pressed. The grid now sends them to the
     page instead, which is where the sizes are. One size is not a choice,
     so that one is still added from here. */
  const needsSize = (p.sizes?.length ?? 0) > 1;

  // Adds the product straight to the list from the catalog grid - no need
  // to open the product page first. Stops the click from also following
  // the card's <Link> to the product page.
  function addToList(e: MouseEvent<HTMLButtonElement>) {
    // Not prevented: the click falls through to the card's own link and
    // opens the page, which is the whole point of the button in this
    // state. Returning before preventDefault is what lets it.
    if (needsSize) return;
    e.preventDefault();
    e.stopPropagation();
    add({ id: p.id, name: p.name, size: p.sizes?.[0] || "",
      price: Number(p.discount_price || p.price), qty: 1,
      seller_id: p.seller_id, sellerName: sellerName || null,
      /* WHAT IT WOULD HAVE COST, when it is on offer. The basket line
         carries it so checkout can show what the shopper saved -- and
         this was the one place that left it out, so the same product
         added from a card showed no saving and added from its own page
         showed one. Only when there IS a discount: see BasketLine. */
      listPrice: p.discount_price != null ? Number(p.price) : undefined,
      image: p.images?.[0] || "", slug: p.slug });
    toast(`${p.name} → ${t("list", lang)}`);
  }

  /* The heart is INSIDE the card's link, so it has to stop the click from
   * also opening the product -- the same problem "add to cart" on this card
   * already has, solved the same way. Optimistic on purpose: the browser's
   * own list is the thing the filled heart is drawn from, so it flips at
   * once and the shop's count follows on the server, which never throws
   * (see toggleLoveAction). */
  function toggleLove(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    const nowLoved = toggle(p.id);
    void toggleLoveAction(p.id, nowLoved);
  }

  return (
    <Link className={"card" + (p.stock_status === "out" ? " is-out" : "")} href={`/p/${p.slug}`}>
      <div className="ph">
        {/* BOTH CORNERS ON ONE ROW, so they cannot collide. See
            .card-badges: laying them out as a flex row is what makes
            "IN STOCK" and "BEST SELLER" measure each other instead of
            each pinning itself to an edge and hoping. */}
        <div className="card-badges">
        <div className="card-tags">
          <span className={"badge " + cls}>{t(key, lang)}</span>
          <button type="button" className={"card-love" + (loved ? " is-on" : "")}
            onClick={toggleLove} aria-pressed={loved}
            aria-label={`${t(loved ? "unlove" : "love", lang)} — ${p.name}`}>
            <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"
              fill="none" strokeLinecap="round" strokeLinejoin="round">
              {/* THE SAME HEART, DRAWN TWICE. The mark has no plate behind
                  it any more, so it has to hold its own over a
                  photograph of any colour: a dark rim first and wider,
                  then the mark itself on top. White on a dark boot, and
                  a white heart with a dark outline on a sandal shot
                  against a white wall -- which a single colour cannot do,
                  and which a blurred shadow only smudges. */}
              <path d={HEART} stroke="rgba(0,0,0,.5)" strokeWidth="4.5" />
              <path d={HEART} stroke="currentColor" strokeWidth="2"
                fill={loved ? "currentColor" : "none"} />
            </svg>
          </button>
        </div>
        {/* THE TOP-RIGHT FLAGS, IN ONE COLUMN.
            "BEST SELLER" and "-40%" used to be two separately positioned
            elements that both claimed top:8px right:8px -- the discount
            inside the photo, the best-seller flag on a wrapper outside the
            card entirely. They landed on the same 8px square and overlapped,
            which is why the row read "BEST -40%": one amber pill with the
            back half of "SELLER" hidden under the discount.

            Stacking them is what keeps both whole. Putting the flag INSIDE
            the card is what keeps it visible: the card lifts to z-index 3
            under the pointer, so a flag sitting outside it was painted over
            and vanished on exactly the card being looked at. */}
        {(flag || pct != null) && (
          <div className="card-flags">
            {flag && <span className="card-flag">{flag}</span>}
            {pct != null && <span className="card-deal">-{pct}%</span>}
          </div>
        )}
        </div>
        {/* next/image, not <img>: on a 360px phone this serves a 360px AVIF
            instead of the full 1200px WebP the seller uploaded -- typically
            an 80-90% saving on the single heaviest asset in the catalog
            grid, on the connections this store was designed around.
            The inline SVG placeholder is passed through unoptimized: it is
            already ~0 bytes and running it through the optimizer would add
            a round trip to save nothing. */}
        <Image
          src={img}
          alt={p.name}
          width={400}
          height={400}
          loading="lazy"
          sizes="(max-width: 600px) 50vw, (max-width: 1000px) 33vw, 240px"
          unoptimized={img.startsWith("data:")}
        />
      </div>
      <div className="body">
        <div className="nm">{p.name}</div>
        <div className="mt">
          {rating != null ? (
            <span className="card-rating" title={`${rating} / 5`}>
              <span className="card-stars" aria-hidden="true">{stars(rating)}</span>
              <span>{rating.toFixed(1)}</span>
              <span className="card-rating-n">({p.rating_count})</span>
            </span>
          ) : null}
          {loc && rating != null ? <span aria-hidden="true">·</span> : null}
          {loc}
        </div>
        <div className="sold-by">{sellerName ? `${t("soldBy", lang)} ${sellerName}` : "\u00A0"}</div>
        {pct != null ? (
          <div className="pr-row">
            <span className="pr-discount">{money(p.discount_price!)}</span>
            <span className="pr-original">{money(p.price)}</span>
            <span className="pr-pct">-{pct}%</span>
          </div>
        ) : (
          <div className="pr">{money(p.price)}</div>
        )}
        <div className="card-add-slot">
          {p.stock_status !== "out" && (
            <button type="button" className="btn btn-sm btn-amber card-add" onClick={addToList}>
              {/* The shop's own cart, the one in the header and the bottom
                  bar -- same component, so the button and the place the
                  goods land are recognisably the same thing. Not shown
                  when the button opens the page instead: a cart on a
                  button that adds nothing to the cart is a promise it does
                  not keep. */}
              {!needsSize && <CartIcon size={15} />}
              {t(needsSize ? "chooseSize" : "addList", lang)}
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}
