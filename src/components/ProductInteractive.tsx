"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBasket } from "@/lib/useBasket";
import { useToast } from "@/components/Toast";
import { bumpWaClickAction } from "@/lib/actions/track";
import {money,waLink, waProductMsg, discountPercent} from "@/lib/utils";
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
    const vals = (p.sizes || [])
      .map((s) => sizePrices?.[s])
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (vals.length < 2) return false;
    return Math.min(...vals) !== Math.max(...vals);
  }, [p.sizes, sizePrices]);

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
    <>
      {/* D3 — the four repeated questions, answered above the fold */}
      <section className="aab" aria-label={t("answers", lang)}>
        <div className="aab-hd">
          <span className="dot" />
          {t("answers", lang)}
        </div>

        <div className="aab-row aab-row-price">
          <div className="aab-q">{t("qPrice", lang)}</div>
          <div className="aab-a">
            {pct != null ? (
              <>
                <span className="aab-price aab-price-discount">{money(p.discount_price!)}</span>
                {/* Struck through: what this SIZE would have cost, not
                    what the product row says. On a shirt whose Large is
                    dearer, crossing out the product's price would show
                    the shopper a saving they are not getting. */}
                <span className="aab-price-original">{money(basePrice)}</span>
                <span className="aab-price-pct">-{pct}%</span>
              </>
            ) : (
              <>
                {/* "From" until a size is chosen, when the sizes are not
                    all one price. A single number over three prices is
                    the one number that is wrong for two of them. */}
                {priceVaries && size == null && (
                  <span className="aab-price-from">{t("priceFrom", lang)}</span>
                )}
                <span className="aab-price">{money(headlinePrice)}</span>
              </>
            )}
            {/* USD, and it says so. Timor-Leste uses the dollar, and a bare
                "$" is ambiguous across a dozen of them. */}
            <em style={{ fontStyle: "normal", fontSize: 12, color: "var(--muted)", marginLeft: 6 }}>USD</em>
          </div>
        </div>

        <div className="aab-row">
          <div className="aab-q">{t("qSize", lang)}</div>
          <div className="aab-a">
            {p.sizes?.length ? (
              /* HOW MANY OF EACH, on the button for it.
                 Offering Large on a product with none left in Large is the
                 thing this whole feature exists to stop. A size with
                 nothing behind it is shown struck through and cannot be
                 picked -- shown rather than hidden, because "they do not
                 stock my size" and "they are out of my size" are different
                 answers and only one of them means come back later. */
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
                           switching to one with 3 left the 5 standing, so
                           the page offered an order it knew would be
                           refused. */
                        const left = tracked ? availableInSize(stock!, s) : null;
                        if (!canPreorder && left != null && left > 0) {
                          setQty((q) => Math.min(q, left));
                        }
                      }}>
                      {s}
                      {left != null && <em>{gone ? "0" : left}</em>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span>—</span>
            )}
          </div>
        </div>

        <div className="aab-row">
          <div className={"aab-q" + (p.stock_status === "out" ? " aab-q-out" : "")}>
            {p.stock_status === "out" ? t("qNotAvailable", lang) : t("qStock", lang)}
          </div>
          <div className="aab-a">
            <span className={"stock-pill " + STOCK_CLS[p.stock_status]}>
              {t(STOCK_KEY[p.stock_status], lang)}
            </span>
            {p.stock_status !== "out" && p.qty ? (
              <small>{p.qty} {t("unitsLeft", lang)}</small>
            ) : null}
          </div>
        </div>
      </section>

      {seller && (
        <div className="panel sold-by-panel">
          <span className="aab-q" style={{ display: "block", marginBottom: 4 }}>{t("soldBy", lang)}</span>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <b>{seller.store_name}</b>
            <Link className="btn btn-sm btn-ghost" href={`/store/${seller.slug}`}>{t("visitStore", lang)}</Link>
          </div>
        </div>
      )}

      {/* When it can be pre-ordered, say when it is expected before asking
          for the order. A buyer committing to a wait deserves to know how
          long, and "we do not know yet" is a fair answer that beats an
          invented date that will be missed. */}
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

      <div className="btn-row">
        {canPreorder ? (
          <button className="btn btn-amber" type="button" onClick={buyNow}>
            {t("preorderNow", lang)}
          </button>
        ) : isOut ? (
          <button className="btn" disabled>{t("stockOut", lang)}</button>
        ) : (
          <button className="btn btn-amber" type="button" onClick={buyNow}>
            {t("buyNow", lang)}
          </button>
        )}
      </div>

      <div className="btn-row">
        {isOut && !canPreorder ? null : (
          <>
            <a
              className="btn btn-wa"
              href={href}
              target="_blank"
              rel="noopener"
              onClick={() => { void bumpWaClickAction(p.id); }}
            >
              <WaIcon />
              {canPreorder ? t("preorderWa", lang) : t("orderWa", lang)}
            </a>
            <button className="btn btn-ghost" type="button" onClick={addToList}>
              {t("addList", lang)}
            </button>
          </>
        )}
      </div>

      <div className="btn-row" style={{ flexDirection: "row", gap: 8 }}>
        <div className="qty" role="group" aria-label={t("qty", lang)}>
          <button type="button" aria-label="-"
            onClick={() => { setCapHit(false); setQty((q) => Math.max(1, q - 1)); }}>−</button>
          <span>{qty}</span>
          {/* STILL CLICKABLE AT THE CEILING, ON PURPOSE.
              The first version of this disabled the button -- which meant
              the click handler never ran, so the red line explaining WHY
              was unreachable and the button just stopped responding. A
              control that goes dead without a word is the thing being fixed
              here, not the fix.

              So it stays live, refuses to count past what is on the shelf,
              and says what is there and what was asked for. aria-disabled
              tells a screen reader it will not act, without taking the
              click -- and the answer -- away. */}
          <button type="button" aria-label="+" aria-disabled={atCap}
            className={atCap ? "is-capped" : undefined}
            onClick={() => {
              if (atCap) { setCapHit(true); return; }
              setCapHit(false);
              setQty((q) => Math.min(maxQty, q + 1));
            }}>+</button>
        </div>
        <button className="btn btn-ghost" type="button" onClick={share} style={{ flex: 1 }}>
          {t("share", lang)}
        </button>
      </div>

      {/* WHAT IS THERE, AND WHAT WAS ASKED FOR, both named.
          "Not enough stock" leaves the shopper to guess how many to take,
          and guessing means pressing + again. role="alert" because it
          appears in response to something they just did and is the answer
          to it -- a screen reader that waits for a gap would announce it
          after they had already pressed + twice more. */}
      {capHit && Number.isFinite(maxQty) && (
        <div className="note bad" role="alert" style={{ marginTop: 8 }}>
          {(size
            ? t("stockCapSize", lang).replace("{s}", size)
            : t("stockCapNoSize", lang))
            .replace("{n}", String(maxQty))
            .replace("{q}", String(qty + 1))}
        </div>
      )}

      <div className="panel">
        <h3>{t("payAccepted", lang)}</h3>
        <div className="rows">
          {payList.filter(([on]) => on).map(([, key]) => (
            <div className="kv" key={key}>
              <span>{t(key, lang)}</span>
              <span className="pill ok">✓</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
