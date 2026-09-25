"use client";
import { useBasket } from "@/lib/useBasket";
import { useLoves } from "@/lib/useLoves";
import { useToast } from "@/components/Toast";
import { toggleLoveAction } from "@/lib/actions/loves";
import HeartIcon from "./HeartIcon";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Lang, Product } from "@/lib/types";

/* Four copies of this map exist across the admin and the storefront. Not
   worth a shared module for three pairs -- and the caption below is the
   only thing here that reads it. */
const STOCK_KEY = { in: "stockIn", low: "stockLow", out: "stockOut" } as const;

/* THE RAIL BESIDE THE PHOTOGRAPH.
 *
 * FNAC runs a narrow column of round icon buttons down the side of the
 * product image -- Wishlists, Compare, Share -- and it is a good place
 * for them: they are things you do ABOUT the product rather than things
 * you do to buy it, so they do not belong in the price card, and a row of
 * text buttons under the image would compete with the description.
 *
 * TWO OF THEM, NOT THREE. Comparing needs a comparison screen to compare
 * on, and a button that opens nothing is worse than no button.
 *
 * Its own component because both of these are client-side: the heart is
 * this browser's own list (localStorage, see useLoves) and sharing is a
 * browser API. The gallery beside it is a server component and should
 * stay one.
 */
export default function ProductActions({
  p, lang, siteOrigin, waNumber,
}: {
  p: Product;
  lang: Lang;
  siteOrigin: string;
  /** For the caption a share carries, so somebody who receives it can
   * order without coming back here first. */
  waNumber: string;
}) {
  const { has, toggle, ready } = useLoves();
  const { toast } = useToast();
  // Keeps the basket hook honest: this component sits next to the card
  // that fills it, and reading nothing from it would be a lie by omission.
  useBasket();

  /* Until the browser's own list has been read, nothing is loved. The
     server does not know which products THIS browser hearted -- the list
     is local -- so rendering a filled heart before the read would flash
     the wrong state on every page load. */
  const loved = ready && has(p.id);

  function toggleLove() {
    const nowLoved = toggle(p.id);
    // The shop's count follows this browser's opinion, not the other way
    // round: the filled heart is drawn from the local list, so it flips
    // instantly and the server is told afterwards.
    void toggleLoveAction(p.id, nowLoved);
    toast(t(nowLoved ? "love" : "unlove", lang));
  }

  async function share() {
    const url = `${siteOrigin}/p/${p.slug}`;
    const caption =
      `${p.name} — ${money(p.price)}\n` +
      `${t("qStock", lang)} ${t(STOCK_KEY[p.stock_status], lang)}\n` +
      `${t("qHow", lang)} WhatsApp ${waNumber}\n` + url;
    /* The phone's own share sheet when there is one, which is what puts
       this into WhatsApp in one tap -- the way most of this shop's
       customers would actually pass a product on. The clipboard is the
       desktop fallback, and a cancelled share is not an error. */
    if (navigator.share) {
      try { await navigator.share({ title: p.name, text: caption, url }); } catch { /* cancelled */ }
      return;
    }
    try { await navigator.clipboard.writeText(caption); } catch { /* denied */ }
    toast(t("copied", lang));
  }

  return (
    <div className="pdp-rail">
      <button type="button" className={"rail-btn" + (loved ? " is-on" : "")}
        onClick={toggleLove} aria-pressed={loved}
        aria-label={`${t(loved ? "unlove" : "love", lang)} — ${p.name}`}>
        {/* No rim: this one sits on a panel, not over a photograph, and
            the dark outline that makes it readable on a boot reads as a
            smudge on paper. See HeartIcon. */}
        <HeartIcon size={20} filled={loved} />
        <span>{t(loved ? "unlove" : "love", lang)}</span>
      </button>

      <button type="button" className="rail-btn" onClick={share}
        aria-label={`${t("share", lang)} — ${p.name}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          strokeLinejoin="round" aria-hidden="true">
          <path d="M12 16V4M8 8l4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
        </svg>
        <span>{t("share", lang)}</span>
      </button>
    </div>
  );
}
