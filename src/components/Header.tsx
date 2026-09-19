import Link from "next/link";
import Image from "next/image";
import LangSwitch from "./LangSwitch";
import CartIcon from "./CartIcon";
import BasketBadge from "./BasketBadge";
import SearchBar from "./SearchBar";
import MegaNav from "./MegaNav";
import TrackIcon from "./TrackIcon";
import MobileNav from "./MobileNav";
import { getCategories, getHeroSlides, getLiveProducts } from "@/lib/data/public";
import { buildNav } from "@/lib/nav";
import { getLang } from "@/lib/lang";
import { supabaseServer } from "@/lib/supabase/server";
import { emailInitials } from "@/lib/initials";
import { t } from "@/lib/i18n";
import type { Settings } from "@/lib/types";

export default async function Header({ settings }: { settings: Settings }) {
  const lang = await getLang();
  // Both reads are cached across requests and deduped within one (see
  // lib/data/public.ts), so putting the navigation in the header costs the
  // pages that already load them nothing at all -- and one shared query
  // every few minutes for the ones that did not.
  const [cats, products, slides] = await Promise.all([
    getCategories(), getLiveProducts(), getHeroSlides(),
  ]);

  /* Who is looking, if anybody. Read from the auth cookie this request
     already carries -- the header is per-request anyway, because the
     language comes from a cookie too. Failing quietly is right: a header
     that cannot render because the auth service is slow is a shop nobody
     can browse. */
  let customerEmail: string | null = null;
  try {
    const sb = await supabaseServer();
    const { data } = await sb.auth.getUser();
    customerEmail = data.user?.email ?? null;
  } catch { customerEmail = null; }
  const initials = emailInitials(customerEmail);
  const navRoots = buildNav(cats, products, lang);
  return (
    <>
      <header className="hd">
        <div className="hd-in">
          {/* Phone only: the menu and search that replace the category row
              and the search strip below the header. Hidden from 768px up,
              where MegaNav's bar and .hd-search do the same jobs with room
              to spell them out. */}
          <MobileNav roots={navRoots} slides={slides} lang={lang} />

          <Link className="hd-logo" href="/" aria-label="Home">
            <Image src="/logo-mark.webp" alt="" width={280} height={115} priority style={{ height: 18, width: "auto" }} />
            <b>{settings.store_name}</b>
          </Link>
          <span className="hd-sp" />

          {/* Desktop only, and it is why .mainnav-search exists too: this
              is a 52px bar with four controls already in it, and a text
              field does not fit beside them on a phone. There the same
              search box sits on its own line under the categories. Only
              one of the two is ever displayed. */}
          <div className="site-search hd-search">
            <SearchBar lang={lang} />
          </div>

          {/* Desktop only — the mobile bottom nav already has this tab,
              but that nav is hidden at desktop widths, so without this
              link there's no way to reach order tracking on desktop. */}
          <Link className="icon-btn hd-track" href="/track">
            <TrackIcon />
            {t("navTrack", lang)}
          </Link>

          <LangSwitch current={lang} />
          {/* WHO IS SIGNED IN, IN TWO LETTERS.
              The person outline is the same drawing whether somebody is
              signed in or not, so the one question it is asked -- am I
              signed in, and as whom? -- it could not answer. Initials from
              the address do, in the space the icon already occupies.

              The icon stays for a visitor who has no account, and for an
              address that yields no usable letters. */}
          <Link className="icon-btn" href="/account"
            aria-label={initials
              ? `${t("myAccount", lang)} — ${customerEmail}`
              : t("myAccount", lang)}
            title={customerEmail || undefined}>
            {initials ? (
              <span className="avatar" aria-hidden="true">{initials}</span>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
              </svg>
            )}
          </Link>
          <Link className="icon-btn hd-cart" href="/list" aria-label={t("navList", lang)}>
            <CartIcon size={17} />
            <BasketBadge as="cnt" />
          </Link>
        </div>
      </header>

      {/* The shop's own aisles, with the search box sitting at the end of
          the same row. It used to be a third sticky strip of its own; a
          storefront does not need three stacked bars of chrome before the
          first product, and search belongs beside the categories it
          searches. MegaNav renders nothing on the admin and seller screens,
          so the search box correctly goes with it. */}
      <MegaNav roots={navRoots} lang={lang} />
    </>
  );
}
