"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBasket } from "@/lib/useBasket";
import { useToast } from "@/components/Toast";
import { bumpWaClickAction } from "@/lib/actions/track";
import { money, waLink, waProductMsg, discountPercent, ratingAverage } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { availableInSize, type SizedStock } from "@/lib/sizeStock";
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
}) {
  const [size, setSize] = useState<string | null>(p.sizes?.length === 1 ? p.sizes[0] : null);
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
  /* What shoppers have said, when any have. Read from the product row
     the page already loaded rather than passed in separately -- the
     reviews list below the card reads the same two columns. */
  const rating = ratingAverage(p);
  const ratingCount = Number(p.rating_count) || 0;

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

  const payList: Array<[boolean, string]> = [
    [p.pay_cod, "pm_cod"], [p.pay_cop, "pm_cop"], [p.pay_bank, "pm_bank"],
    [p.pay_wallet, "pm_wallet"],
  ];

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

  async function share() {
    const caption =
      `${p.name} — ${money(p.price)}\n` +
      `${t("qStock", lang)} ${t(STOCK_KEY[p.stock_status], lang)}\n` +
      `${t("qHow", lang)} WhatsApp ${settings.wa_number}\n` +
      siteUrl(`/p/${p.slug}`);
    if (navigator.share) {
      try { await navigator.share({ title: p.name, text: caption, url: siteUrl(`/p/${p.slug}`) }); } catch {}
      return;
    }
    try {
      await navigator.clipboard.writeText(caption);
      toast(t("copied", lang));
    } catch {
      toast(t("copied", lang));
    }
  }

  return (
    /* THE BUY CARD.
     *
     * This was a label-and-value table headed "ALL ANSWERS, HERE" --
     * PRICE, SIZE, AVAILABLE down the left, answers down the right --
     * with the buttons stacked underneath it and the product's name
     * somewhere above, outside. It answered the right questions in the
     * wrong shape: a table is for comparing rows, and nobody compares the
     * price of a thing with its size.
     *
     * It reads top to bottom now, the way every shop this one competes
     * with reads: what it is, what it costs, which one you want, how many,
     * and the button. The card is sticky on a desktop (see .pdp-buy in
     * globals.css) so it stays beside the photographs and the description
     * however far down the page somebody scrolls -- the whole point of a
     * long product page is that the thing you buy with never leaves.
     */
    <div className="buybox">
      <h1 className="buybox-nm">{p.name}</h1>

      {/* Rating before price, as both of the shops this borrows from do:
          it is the reassurance that makes the number readable. Absent
          until somebody has actually rated it -- no empty stars. */}
      {rating != null && (
        <div className="buybox-rate">
          <span className="stars" aria-hidden="true">
            {"★★★★★".slice(0, Math.round(rating))}
            <span className="stars-off">{"★★★★★".slice(Math.round(rating))}</span>
          </span>
          <b>{rating.toFixed(1)}</b>
          <span>({ratingCount})</span>
        </div>
      )}

      <div className="buybox-price">
        {/* "From" until a size is chosen, when the sizes are not all one
            price. A single number over three prices is the one number
            that is wrong for two of them. */}
        {priceVaries && size == null && (
          <span className="buybox-from">{t("priceFrom", lang)}</span>
        )}
        <span className="buybox-now">{money(pct != null ? p.discount_price! : headlinePrice)}</span>
        {pct != null && (
          <>
            {/* Struck through: what this SIZE would have cost, not what
                the product row says. On a shirt whose Large is dearer,
                crossing out the product's price would show a saving the
                shopper is not getting. */}
            <s className="buybox-was">{money(basePrice)}</s>
            <span className="buybox-off">-{pct}%</span>
          </>
        )}
        {/* USD, and it says so. Timor-Leste uses the dollar and a bare
            "$" is ambiguous across a dozen of them. */}
        <em className="buybox-cur">USD</em>
      </div>

      {seller && (
        <div className="buybox-seller">
          <span>{t("soldBy", lang)}</span>
          <Link href={`/store/${seller.slug}`}>{seller.store_name}</Link>
        </div>
      )}

      {p.sizes?.length ? (
        <div className="buybox-opt">
          <span className="buybox-lbl">{t("qSize", lang)}</span>
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

      {/* HOW YOU CAN PAY, as one line of chips rather than a panel of
          rows. It is reassurance, not a decision -- nothing here is
          chosen, and a bordered box with a heading gave four facts the
          same weight as the price. */}
      <ul className="buybox-pay">
        {payList.filter(([on]) => on).map(([, key]) => (
          <li key={key}>{t(key, lang)}</li>
        ))}
      </ul>

      <button className="buybox-share" type="button" onClick={share}>
        {t("share", lang)}
      </button>
    </div>
  );
}
