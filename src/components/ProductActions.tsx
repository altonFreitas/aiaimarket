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

/* THE BUTTONS OVER THE PHOTOGRAPH.
 *
 * The reference puts a heart in the top-right corner OF THE PICTURE, and
 * that is where it belongs: it is a thing you do about the product, not a
 * field in the price card, and there it is where a shopper's eye already
 * is. Sharing goes beside it for the same reason.
 *
 * TWO OF THEM, NOT THREE. The FNAC rail this replaces had room for
 * Compare as well, and comparing needs a comparison screen to compare on.
 * A button that opens nothing is worse than no button.
 *
 * ROUND, ON A WHITE DISC, because they sit on a photograph and a
 * photograph can be any colour underneath them.
 *
 * Its own component because both are client-side: the heart is this
 * browser's own list (localStorage, see useLoves) and sharing is a
 * browser API.
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
    <>
      <button type="button" className={"gal-act" + (loved ? " is-on" : "")}
        onClick={toggleLove} aria-pressed={loved}
        aria-label={`${t(loved ? "unlove" : "love", lang)} — ${p.name}`}
        title={t(loved ? "unlove" : "love", lang)}>
        {/* No rim on the heart itself: the disc under it is what makes it
            readable over a photograph, and a second dark outline inside
            that would read as a smudge. See HeartIcon. */}
        <HeartIcon size={18} filled={loved} />
      </button>

      <button type="button" className="gal-act" onClick={share}
        aria-label={`${t("share", lang)} — ${p.name}`} title={t("share", lang)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          strokeLinejoin="round" aria-hidden="true">
          <path d="M12 16V4M8 8l4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
        </svg>
      </button>
    </>
  );
}
