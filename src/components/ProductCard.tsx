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
import HeartIcon from "./HeartIcon";
import { toggleLoveAction } from "@/lib/actions/loves";
import { useToast } from "@/components/Toast";
import type { Product } from "@/lib/types";
import type { CardFacts } from "@/lib/cardFacts";
import type { Lang } from "@/lib/types";

const BADGE = { in: ["b-in", "stockIn"], low: ["b-low", "stockLow"], out: ["b-out", "stockOut"] } as const;


export default function ProductCard(
  { p, lang, sellerName, flag, facts, isNew }:
  {
    p: Product; lang: Lang; sellerName?: string; flag?: string;
    /* THE COLOURS AND SIZES THIS IS SOLD IN, read for the whole page at
       once (lib/data/cardFacts.ts). Optional, and absent everywhere the
       card is drawn outside a catalogue grid -- a homepage rail costs no
       extra query and simply shows no rows. */
    facts?: CardFacts;
    /* Worked out on the server, not here: this component is a client one,
       and asking the clock on both sides of the boundary is how a card
       renders NEW on the server and not in the browser. */
    isNew?: boolean;
  },
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
            {/* Rimmed, because this one sits over the photograph -- see
                HeartIcon for why that is a prop rather than the default. */}
            <HeartIcon size={19} filled={loved} rimmed />
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
        {(flag || isNew || pct != null) && (
          <div className="card-flags">
            {flag && <span className="card-flag">{flag}</span>}
            {/* Only when it is: see lib/cardBadges.ts. A shop where every
                card says NEW has said nothing. */}
            {isNew && !flag && <span className="card-new">{t("newBadge", lang)}</span>}
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
        {/* WHO MADE IT, ABOVE WHAT IT IS. The reference puts the brand on
            its own line over the name, and in this marketplace the brand
            is the shop that stocks it -- the only one the catalogue
            actually knows. It said "Sold by AITA STORE" under the price
            before, which is the same fact three words longer and in the
            place the eye reaches last. The blank keeps every card's body
            the same height when a product has no seller on it. */}
        <div className="card-brand">{sellerName || "\u00A0"}</div>
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
        {pct != null ? (
          /* No percentage here: it is already the red flag on the corner
             of the photograph, and printing it twice on one card is the
             same number arguing with itself. The struck-through list price
             is what this row adds. */
          <div className="pr-row">
            <span className="pr-discount">{money(p.discount_price!)}</span>
            <span className="pr-original">{money(p.price)}</span>
          </div>
        ) : (
          <div className="pr">{money(p.price)}</div>
        )}
        {/* THE COLOURS IT COMES IN, as dots.
            Two or more only: one colour is not a choice, and a single dot
            reads as a picker with nothing in it. A value that names no
            drawable colour ("Natural", a supplier's code) gets no dot --
            a black square meaning "not understood" is worse than nothing,
            so the row is only drawn when something can be drawn. */}
        {facts && facts.colors.filter((c) => c.swatch).length > 1 && (
          <ul className="card-colors" aria-label={t("color", lang)}>
            {facts.colors.filter((c) => c.swatch).map((c) => (
              <li key={c.value} className="card-color" style={{ background: c.swatch! }}>
                <span className="sr-only">{c.name}</span>
              </li>
            ))}
          </ul>
        )}

        {/* THE SIZES, AND WHICH ONES ARE THERE.
            inStock === false is struck through; null is printed plainly,
            because null means the ledger has never been told about this
            product rather than that it has none. Saying "sold out" on
            evidence nobody collected is the kind of promise this shop
            does not make. */}
        {facts && facts.sizes.length > 0 && (
          <ul className="card-sizes" aria-label={t("size", lang)}>
            {facts.sizes.map((s) => (
              <li key={s.size}
                className={"card-size" + (s.inStock === false ? " is-gone" : "")}>
                {s.size}
              </li>
            ))}
          </ul>
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
