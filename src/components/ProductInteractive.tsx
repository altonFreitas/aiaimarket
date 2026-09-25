"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBasket } from "@/lib/useBasket";
import { useToast } from "@/components/Toast";
import CartIcon from "./CartIcon";
import SpecIcon from "./SpecIcon";
import { bumpWaClickAction } from "@/lib/actions/track";
import { money, waLink, waProductMsg, discountPercent } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { availableInSize, type SizedStock } from "@/lib/sizeStock";
import type { ProductColor } from "@/lib/data/productColors";
import type { DeliveryPromise } from "@/lib/deliveryPromise";
import type { Lang, Product, Settings } from "@/lib/types";

const STOCK_CLS = { in: "stock-in", low: "stock-low", out: "stock-out" } as const;
const STOCK_KEY = { in: "stockIn", low: "stockLow", out: "stockOut" } as const;

function WaIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 2a8 8 0 1 1-4.1 14.8l-.3-.2-2.6.7.7-2.5-.2-.3A8 8 0 0 1 12 4zm-3.2 4c-.2 0-.5.1-.7.4-.3.3-.9.9-.9 2.1 0 1.2.9 2.4 1 2.6.1.2 1.7 2.8 4.3 3.8 2.1.8 2.5.7 3 .6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.7-.4-1.4-.7c-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1-.2-.1-1-.4-1.9-1.2-.7-.6-1.2-1.4-1.3-1.6-.1-.2 0-.3.1-.4l.4-.5.3-.5v-.4l-.7-1.6c-.2-.4-.4-.4-.5-.4h-.1z" />
    </svg>
  );
}

export default function ProductInteractive({
  p, settings, lang, siteOrigin, seller, stock, sizePrices,
  colors = [], tiles = [], average = null, ratingCount = 0,
  promises = [], deliveryFee = null, brand = null,
}: {
  p: Product; settings: Settings; lang: Lang; siteOrigin: string;
  seller?: { store_name: string; slug: string } | null;
  /** How many of each size are on the shelf. Absent on a database that has
   * not run supabase/size-stock.sql, and on a product nobody has counted
   * by size -- in both cases the picker behaves exactly as it always did. */
  stock?: SizedStock | null;
  /** What each size sells for, when the purchase order set them apart --
   * see lib/data/sizePrices.ts. A plain object rather than a Map, because
   * this crosses the server -> client boundary. Empty for a product
   * bought at one price, and for a fridge. */
  sizePrices?: Record<string, number>;
  /** The colours this is sold in -- see lib/data/productColors.ts. One
   * of them is a label rather than a choice, and the panel says so. */
  colors?: ProductColor[];
  /** The three tiles over the description: Material, Fit, Gender and the
   * like, picked by slug so they are the same three on every product
   * that answers them. */
  tiles?: Array<{ slug: string; label: string; value: string }>;
  /** The star average, or null when nobody has reviewed it. */
  average?: number | null;
  ratingCount?: number;
  /** What the shop promises about getting it to you, read out of
   * Settings -- see lib/deliveryPromise.ts. */
  promises?: DeliveryPromise[];
  /** The delivery fee that goes with a non-free delivery promise. */
  deliveryFee?: number | null;
  /** The brand, when the product answers that attribute. Printed beside
   * the reference under the buttons, where a shop puts a SKU. */
  brand?: string | null;
}) {
  const [size, setSize] = useState<string | null>(p.sizes?.length === 1 ? p.sizes[0] : null);
  /* The colour, when there is a choice. Pre-selected when there is only
     one, because then it is a statement of fact rather than a question
     and leaving it unpicked would look like an unanswered form. */
  const [color, setColor] = useState<string | null>(
    colors.length === 1 ? colors[0].value : null);
  /* Straight off the product row -- supabase/product-highlights.sql. The
     `?? []` is the migration window: a database without that column hands
     back undefined, and a listing with no highlights draws no block. */
  const highlights: string[] = Array.isArray(p.highlights) ? p.highlights : [];
  /* Counts are shown only once the shop has actually counted a size. Until
     then every size would read 0 and the page would say the shelf is empty
     when it is full -- see lib/sizeStock.ts. */
  const tracked = !!stock?.tracked;
  const [qty, setQty] = useState(1);
  const { add } = useBasket();
  const { toast } = useToast();
  /* THE PRICE FOLLOWS THE SIZE.
   *
   * A purchase order buys a shirt in XS, S and M on three rows, each with
   * its own selling price, and receiving writes each onto its variant.
   * The page was quoting one number for all three -- whichever the
   * product row happened to carry -- so a shopper picking the larger size
   * saw the smaller size's price right up until the basket.
   *
   * Falls back to the product's own price for a size nobody priced
   * separately, which is every size on a product bought at one price.
   *
   * A DISCOUNT STILL WINS. discount_price is the shop saying "this
   * product is on offer at this number"; a per-size price is what the
   * size costs normally. Honouring the size's price over a live discount
   * would silently cancel the offer for anyone who picked a size. */
  const sizePrice = size != null ? sizePrices?.[size] : undefined;
  const basePrice = sizePrice != null && Number.isFinite(sizePrice)
    ? Number(sizePrice) : Number(p.price);
  const pct = discountPercent(basePrice, p.discount_price);
  const effectivePrice = p.discount_price ?? basePrice;

  /** What the big number says before a size is chosen: the cheapest size
   * that is real, so a shopper is never quoted less than they can buy at
   * -- the same direction the card errs in (lowerPriceTo in
   * lib/receiving.ts). Once a size IS chosen it is that size's price. */
  const headlinePrice = useMemo(() => {
    if (size != null) return basePrice;
    const vals = (p.sizes || [])
      .map((sz) => sizePrices?.[sz])
      .filter((v): v is number => v != null && Number.isFinite(v));
    return vals.length ? Math.min(...vals) : Number(p.price);
  }, [size, basePrice, p.sizes, p.price, sizePrices]);

  /** Whether the sizes cost different amounts, which is what turns the
   * headline into a "from". Two prices that happen to be equal are not a
   * range and do not get the word. */
  const priceVaries = useMemo(() => {
    /* NOT WHILE A DISCOUNT IS ON. discount_price is one number the shop
       has put on the whole product, so every size costs it -- and the
       page was saying "From $12.00" over a price that was $12.00 for all
       four sizes. A range that is not a range. */
    if (p.discount_price != null && p.discount_price > 0) return false;
    const vals = (p.sizes || [])
      .map((s) => sizePrices?.[s])
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (vals.length < 2) return false;
    return Math.min(...vals) !== Math.max(...vals);
  }, [p.sizes, p.discount_price, sizePrices]);

  const siteUrl = (path: string) => `${siteOrigin}${path}`;
  const waDigits = settings.wa_number.replace(/[^\d]/g, "");
  const msg = waProductMsg({ ...p, price: effectivePrice }, size, qty, siteUrl);
  const href = waLink(waDigits, msg);

  // `loc` (a pickup-location fallback merging product overrides onto the
  // store defaults) was built here and never rendered. Removed rather than
  // left to rot; the fallback logic still lives in the checkout flow.

  // Out of stock is not automatically a dead end. A missing
  // preorder_enabled reads as allowed, matching the column default and
  // a database that has not run supabase/preorders.sql yet.
  const isOut = p.stock_status === "out";
  const canPreorder = isOut && p.preorder_enabled !== false;

  /* WHAT THE SHELF ACTUALLY HOLDS, for the size being bought.
   *
   * The + button counted up for ever. A shopper could ask for 11 of a size
   * with 3 on the shelf, reach the checkout, and only find out when the
   * order was refused -- the database has always refused it
   * (reserve_order_stock), which is why this was never an oversell, but it
   * was a wasted trip through a form.
   *
   * A PRE-ORDER HAS NO CEILING. Ordering ahead is precisely ordering what
   * is not on the shelf, so the cap is lifted rather than set to zero.
   *
   * Infinity when nothing is countable -- a shop that has not counted this
   * product by size, or a database without supabase/size-stock.sql -- which
   * leaves the button behaving exactly as it did before. */
  const sizeLeft = tracked && size ? availableInSize(stock!, size) : null;
  const productLeft = Number.isFinite(Number(p.qty)) && Number(p.qty) > 0
    ? Number(p.qty) : null;
  const maxQty = canPreorder ? Infinity
    : sizeLeft != null ? sizeLeft
      : productLeft != null ? productLeft : Infinity;
  const atCap = Number.isFinite(maxQty) && qty >= maxQty;
  /** Shown in red under the buttons once somebody has pressed + at the
   * ceiling. Cleared as soon as the quantity or the size changes: a warning
   * about a number nobody is asking for any more is noise. */
  const [capHit, setCapHit] = useState(false);

  /* The payment methods used to be a block at the bottom of this card.
     They moved into the Shipping & returns tab (see ProductTabs), where
     they sit beside the delivery fees and the returns window -- the
     three things a shopper asks in one breath, and three blocks in the
     buy panel was three blocks competing with the button. */

  function addToList() {
    // Belt and braces with the disabled button: the size could have sold
    // out in another tab since this page was rendered. The database refuses
    // it too (reserve_order_stock), so this is the polite version of an
    // answer the shop will give anyway.
    if (tracked && size && availableInSize(stock!, size) <= 0) {
      toast(t("sizeSoldOut", lang), true);
      return;
    }
    if (p.sizes?.length > 1 && !size) {
      toast(t("chooseSize", lang), true);
      return;
    }
    add({ id: p.id, name: p.name, size: size || p.sizes?.[0] || "", price: Number(effectivePrice), qty,
      seller_id: p.seller_id, sellerName: seller?.store_name || null,
      // Only when there IS one: see BasketLine.listPrice.
      listPrice: p.discount_price != null ? Number(p.price) : undefined,
      image: p.images?.[0] || "", slug: p.slug });
    toast(`${p.name} → ${t("list", lang)}`);
  }

  const router = useRouter();
  function buyNow() {
    // Belt and braces with the disabled button: the size could have sold
    // out in another tab since this page was rendered. The database refuses
    // it too (reserve_order_stock), so this is the polite version of an
    // answer the shop will give anyway.
    if (tracked && size && availableInSize(stock!, size) <= 0) {
      toast(t("sizeSoldOut", lang), true);
      return;
    }
    if (p.sizes?.length > 1 && !size) {
      toast(t("chooseSize", lang), true);
      return;
    }
    add({ id: p.id, name: p.name, size: size || p.sizes?.[0] || "", price: Number(effectivePrice), qty,
      seller_id: p.seller_id, sellerName: seller?.store_name || null,
      // Only when there IS one: see BasketLine.listPrice.
      listPrice: p.discount_price != null ? Number(p.price) : undefined,
      image: p.images?.[0] || "", slug: p.slug });
    router.push("/checkout");
  }



  return (
    /* TWO COLUMNS OUT OF ONE COMPONENT.
     *
     * The reference puts the price in the MIDDLE column, under the title,
     * and the size picker in the RIGHT one. This shop's prices follow the
     * size -- a purchase order buys a shirt in three sizes at three
     * prices -- so the two cannot be separate components with separate
     * state: picking Large in the right column has to change the number
     * in the middle one.
     *
     * A fragment, so both divs land as direct children of the .pdp grid
     * and take their own cells. Everything in the left-hand column is
     * plain data (strings and numbers), so nothing is dragged across the
     * server boundary that should have stayed on it.
     */
    <>
      <div className="pdp-info">
        {/* THE NAME, over the photograph's column rather than inside the
            price card. It was in the card, which made the price the
            second thing read and left the picture captionless. */}
        <h1 className="pdp-nm">{p.name}</h1>

        <div className="pdp-meta">
          {average != null && (
            <a className="pdp-rate" href="#reviews">
              <span className="stars" aria-hidden="true">
                {"\u2605\u2605\u2605\u2605\u2605".slice(0, Math.round(average))}
                <span className="stars-off">
                  {"\u2605\u2605\u2605\u2605\u2605".slice(Math.round(average))}
                </span>
              </span>
              <b>{average.toFixed(1)}</b>
              <span>({ratingCount} {t("tabReviews", lang).toLowerCase()})</span>
            </a>
          )}
          {/* A dot and a word, the way the reference marks it -- next to
              the rating rather than as a pill three rows down, because
              "is it in stock" is asked at the same moment as "is it any
              good". */}
          <span className={"pdp-stock " + STOCK_CLS[p.stock_status]}>
            <i aria-hidden="true" />
            {t(STOCK_KEY[p.stock_status], lang)}
          </span>
        </div>

        <div className="buybox-price">
          {/* "From" until a size is chosen, when the sizes are not all one
              price. A single number over three prices is the one number
              that is wrong for two of them. */}
          {priceVaries && size == null && (
            <span className="buybox-from">{t("priceFrom", lang)}</span>
          )}
          {/* RED WHEN IT IS A DISCOUNT, ink when it is just the price.
              Colour carrying meaning rather than decoration: a red number
              beside a struck-through one says "this is less than it was"
              without a word. */}
          <span className={"buybox-now" + (pct != null ? " is-off" : "")}>
            {money(pct != null ? p.discount_price! : headlinePrice)}
          </span>
          {/* USD, and it says so. Timor-Leste uses the dollar and a bare
              "$" is ambiguous across a dozen of them. */}
          <em className="buybox-cur">USD</em>
          {pct != null && (
            <>
              {/* Struck through: what this SIZE would have cost, not what
                  the product row says. On a shirt whose Large is dearer,
                  crossing out the product's price would show a saving the
                  shopper is not getting. */}
              <s className="buybox-was">{money(basePrice)}</s>
              <span className="buybox-off">{pct}% OFF</span>
            </>
          )}
        </div>
        {pct != null && (
          <p className="buybox-save">
            {t("youSave", lang)} <b>{money(basePrice - p.discount_price!)}</b>
          </p>
        )}

        {/* THREE FACTS, AS TILES. The reference lifts Material, Fit and
            Gender out of the specification table and puts them where the
            eye lands. They are still in the table below -- this is the
            summary, not a second source. Drawn only when the product
            answers them; two tiles is fine, none means no strip. */}
        {tiles.length > 0 && (
          <div className="pdp-tiles">
            {tiles.map((x) => (
              <div key={x.label} className="pdp-tile">
                {/* The mark first, the way the reference reads: the icon
                    says what KIND of fact this is before the words do. */}
                <SpecIcon slug={x.slug} />
                <div>
                  <b>{x.value}</b>
                  <span>{x.label}</span>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

      {/* WHAT YOU CHOOSE AND PRESS. Pinned beside the page on a wide
          screen, so it never scrolls away while the description is being
          read. The price is NOT in here any more -- it is over in the
          middle column where the reference puts it, and this component
          owns both so that picking a size can still change it. */}
      <div className="pdp-buy">
        <div className="buybox">
          {/* THE COLOUR. A row of swatches when there is a choice, and the
              same row with one swatch when there is not -- the heading
              names the colour either way, which is a fact worth stating
              even when there is nothing to decide. A product with no
              colour answer at all draws none of this. */}
          {colors.length > 0 && (
            <div className="buybox-opt">
              <span className="buybox-lbl">
                {t("colorLabel", lang)}: <b>{(colors.find((c) => c.value === color) ?? colors[0]).name}</b>
              </span>
              <div className="swatches">
                {colors.map((c) => {
                  const on = (color ?? colors[0].value) === c.value;
                  const only = colors.length === 1;
                  return (
                    <button key={c.value} type="button"
                      className={"swatch" + (on ? " is-on" : "")}
                      aria-pressed={on}
                      /* One colour is not a choice, so the single swatch
                         is not a control: a button that cannot change
                         anything still takes a tab stop and still invites
                         a press that does nothing. */
                      disabled={only}
                      aria-label={c.name}
                      title={c.name}
                      onClick={() => setColor(c.value)}>
                      <span style={c.swatch ? { background: c.swatch } : undefined}>
                        {/* No swatch colour means the value named nothing
                            drawable. The word is then the whole answer,
                            rather than a black square meaning "we did not
                            understand". */}
                        {!c.swatch && c.name.slice(0, 2)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {p.sizes?.length ? (
            <div className="buybox-opt">
              <span className="buybox-lbl">
                {t("sizeLabel", lang)}{size ? <>: <b>{size}</b></> : null}
              </span>
            {/* HOW MANY OF EACH, on the button for it.
                Offering Large on a product with none left in Large is the
                thing this exists to stop. A size with nothing behind it is
                shown struck through and cannot be picked -- shown rather
                than hidden, because "they do not stock my size" and "they
                are out of my size" are different answers and only one of
                them means come back later. */}
            <div className={"sizes" + (tracked ? " has-counts" : "")}>
              {p.sizes.map((s) => {
                const left = tracked ? availableInSize(stock!, s) : null;
                const gone = left === 0;
                return (
                  <button key={s} type="button" disabled={gone}
                    className={gone ? "is-gone" : ""}
                    aria-pressed={size === s}
                    aria-label={left == null ? s
                      : gone ? `${s} — ${t("sizeSoldOut", lang)}`
                      : `${s} — ${left} ${t("unitsLeft", lang)}`}
                    onClick={() => {
                      setSize(s);
                      setCapHit(false);
                      /* A QUANTITY THAT NO LONGER FITS IS NOT KEPT.
                         Choosing 5 of a size with 8 on the shelf and then
                         switching to one with 3 left the 5 standing, so the
                         page offered an order it knew would be refused. */
                      const n = tracked ? availableInSize(stock!, s) : null;
                      if (!canPreorder && n != null && n > 0) setQty((q) => Math.min(q, n));
                    }}>
                    {s}
                    {left != null && <em>{gone ? "0" : left}</em>}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="buybox-stock">
          <span className={"stock-pill " + STOCK_CLS[p.stock_status]}>
            {t(STOCK_KEY[p.stock_status], lang)}
          </span>
          {p.stock_status !== "out" && p.qty ? (
            <small>{p.qty} {t("unitsLeft", lang)}</small>
          ) : null}
        </div>

        {/* When it can be pre-ordered, say when it is expected BEFORE asking
            for the order. A buyer committing to a wait deserves to know how
            long, and "we do not know yet" beats an invented date. */}
        {canPreorder && (
          <div className="note info preorder-note">
            <b>{t("preorderTitle", lang)}</b>
            <span>
              {p.preorder_eta
                ? `${t("preorderEta", lang)}: ${p.preorder_eta}`
                : t("preorderEtaUnknown", lang)}
            </span>
          </div>
        )}

        {/* The quantity and the main action on ONE row, which is the shape
            both of the shops this borrows from use: the number you are
            buying belongs against the button that buys it, not three rows
            away under a separate heading. */}
        <div className="buybox-buy">
          <div className="qty" role="group" aria-label={t("qty", lang)}>
            <button type="button" aria-label="-"
              onClick={() => { setCapHit(false); setQty((q) => Math.max(1, q - 1)); }}>−</button>
            <span>{qty}</span>
            {/* STILL CLICKABLE AT THE CEILING, ON PURPOSE.
                The first version disabled this -- so the click handler never
                ran, the red line explaining why was unreachable, and the
                button simply stopped responding. A control that goes dead
                without a word is the thing being fixed here, not the fix.
                aria-disabled tells a screen reader it will not act without
                taking the click, and the answer, away. */}
            <button type="button" aria-label="+" aria-disabled={atCap}
              className={atCap ? "is-capped" : undefined}
              onClick={() => {
                if (atCap) { setCapHit(true); return; }
                setCapHit(false);
                setQty((q) => Math.min(maxQty, q + 1));
              }}>+</button>
          </div>
          {isOut && !canPreorder ? (
            <button className="btn btn-lg" disabled>{t("stockOut", lang)}</button>
          ) : (
            <button className="btn btn-amber btn-lg" type="button" onClick={addToList}>
              {/* The shop's own cart -- the one in the header and on every
                  catalogue card. Same component, so the button and the
                  place the goods land are recognisably the same thing. */}
              <CartIcon size={18} />
              {t("addList", lang)}
            </button>
          )}
        </div>

        {/* WHAT IS THERE, AND WHAT WAS ASKED FOR, both named.
            "Not enough stock" leaves the shopper to guess how many to take,
            and guessing means pressing + again. role="alert" because it is
            the answer to something they just did. */}
        {capHit && Number.isFinite(maxQty) && (
          <div className="note bad" role="alert">
            {(size
              ? t("stockCapSize", lang).replace("{s}", size)
              : t("stockCapNoSize", lang))
              .replace("{n}", String(maxQty))
              .replace("{q}", String(qty + 1))}
          </div>
        )}

        {(!isOut || canPreorder) && (
          <div className="buybox-alt">
            <button className="btn" type="button" onClick={buyNow}>
              {canPreorder ? t("preorderNow", lang) : t("buyNow", lang)}
            </button>
            <a className="btn btn-wa" href={href} target="_blank" rel="noopener"
              onClick={() => { void bumpWaClickAction(p.id); }}>
              <WaIcon />
              {canPreorder ? t("preorderWa", lang) : t("orderWa", lang)}
            </a>
          </div>
        )}

      {/* WHAT THE SHOP PROMISES ABOUT GETTING IT TO YOU.
          The reference reads "Free shipping on orders over $50" here.
          This shop has no such threshold -- delivery is a fee per zone
          plus collection in store -- so that line would be a promise on
          the product page that nobody in the shop had made, and a
          shopper who read it and was then charged would have been misled
          by the website. Every line here is read out of Settings and a
          setting that is not there produces no line. See
          lib/deliveryPromise.ts. */}
      {promises.length > 0 && (
        <ul className="buybox-promise">
          {promises.map((pr) => (
            <li key={pr.key}>
              <PromiseIcon kind={pr.kind} />
              <span>
                {pr.key === "promiseFeeTo" && deliveryFee != null
                  ? `${t(pr.key, lang).replace("{n}", t(pr.n!, lang))} — ${money(deliveryFee)}`
                  : t(pr.key, lang).replace("{n}", pr.n ? (pr.kind === "delivery" ? t(pr.n, lang) : pr.n) : "")}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* THE REFERENCE AND THE BRAND, in the smallest type on the panel.
          A shopper quoting a product over WhatsApp reads the reference
          out; nobody browsing needs it, so it sits under everything
          else rather than beside the price. */}
      <p className="buybox-sku">
        <span>{t("skuLabel", lang)}: <b className="mono">{p.ref}</b></span>
        {brand && <span>{t("brandLabel", lang)}: <b>{brand}</b></span>}
        {seller && (
          <span>
            {t("soldBy", lang)} <Link href={`/store/${seller.slug}`}>{seller.store_name}</Link>
          </span>
        )}
      </p>
        </div>
      </div>
      {/* WHAT IT IS LIKE, in a block of its own rather than the rest of
          the middle column.
          THE REASON IS THE PHONE. Stacked, the document order is the only
          order there is, and with the description inside .pdp-info the
          Add to cart button sat below however many words a supplier's
          description runs to. Split out, the phone reads picture, name,
          price, the panel you press, and THEN the prose -- and on a wide
          screen this simply takes the cell under .pdp-info in the same
          middle column, which is where the reference has it. */}
      <div className="pdp-about">
        {p.description?.trim() && (
          <section className="pdp-desc">
            <h2>{t("aboutThis", lang)}</h2>
            <div className="pdp-scroll" tabIndex={0}
              style={{ whiteSpace: "pre-wrap" }}>{p.description}</div>
          </section>
        )}

        {/* THE TICKED ONE-LINERS. Two columns on a wide screen, one on a
            phone -- they are short by construction (120 characters, see
            supabase/product-highlights.sql) so two fit side by side. */}
        {highlights.length > 0 && (
          <ul className="pdp-ticks">
            {highlights.map((h) => (
              <li key={h}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                  strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" opacity=".35" />
                  <path d="M8 12.5l2.6 2.6L16 9.5" />
                </svg>
                {h}
              </li>
            ))}
          </ul>
        )}
      </div>

    </>
  );
}

/** The mark beside each promise -- a van, a shop door, an arrow coming
 *  back. Three drawings rather than one generic tick, because they say
 *  three different things and a column of identical ticks reads as one
 *  claim repeated. */
function PromiseIcon({ kind }: { kind: DeliveryPromise["kind"] }) {
  const common = {
    width: 16, height: 16, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 2,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (kind === "delivery") {
    return (
      <svg {...common}>
        <path d="M1 6h12v10H1zM13 10h4l3 3v3h-7z" />
        <circle cx="6" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" />
      </svg>
    );
  }
  if (kind === "pickup") {
    return (
      <svg {...common}>
        <path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v11h16V9" />
        <path d="M10 20v-6h4v6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
    </svg>
  );
}
