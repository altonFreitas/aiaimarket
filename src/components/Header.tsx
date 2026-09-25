import Link from "next/link";
import Image from "next/image";
import LangSwitch from "./LangSwitch";
import CartIcon from "./CartIcon";
import BasketBadge from "./BasketBadge";
import SearchBar from "./SearchBar";
import TrackIcon from "./TrackIcon";
import MobileNav from "./MobileNav";
import HeaderNav from "./HeaderNav";
import HeartIcon from "./HeartIcon";
import LovesBadge from "./LovesBadge";
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
              where the shop icon and .hd-search do the same jobs with
              room to spell them out. */}
          <MobileNav roots={navRoots} slides={slides} lang={lang} />

          <Link className="hd-logo" href="/" aria-label="Home">
            <Image src="/logo-mark.webp" alt="" width={280} height={115} priority style={{ height: 18, width: "auto" }} />
            <b>{settings.store_name}</b>
          </Link>

          {/* THE AISLES, ACROSS THE MIDDLE.
              A single "Shop all" icon stood here, which was itself what
              replaced a bar of category buttons under the header. The
              reference puts a real nav back -- Home, Shop, Categories,
              About, Contact -- and the two dropdowns carry what the icon
              could only point at. Desktop only: below 1024 MobileNav's
              sheet has the same links with room to spell them out. */}
          {/* A spacer each side, so the nav sits centred in what the logo
              and the controls leave rather than pinned against the logo. */}
          <span className="hd-sp" />
          <HeaderNav roots={navRoots} lang={lang} />
          <span className="hd-sp" />

          <div className="site-search hd-search">
            <SearchBar lang={lang} />
          </div>

          {/* Desktop only — the mobile bottom nav already has this tab,
              but that nav is hidden at desktop widths, so without this
              link there's no way to reach order tracking on desktop. */}
          <Link className="icon-btn hd-track" href="/track"
            aria-label={t("navTrack", lang)}>
            <TrackIcon />
            {/* In a span so the breakpoint can drop the word and keep the
                icon -- five controls stand in this row now. */}
            <span>{t("navTrack", lang)}</span>
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
          {/* THE HEART, WITH SOMEWHERE TO GO.
              Hearts have been on every card since loves.sql and the
              count has never been clickable. /loves is the page it
              opens; the number is this browser's own, so it is drawn on
              the client -- see LovesBadge. */}
          <Link className="icon-btn hd-loves" href="/loves" aria-label={t("navLoves", lang)}>
            <HeartIcon size={17} />
            <LovesBadge />
          </Link>
          <Link className="icon-btn hd-cart" href="/list" aria-label={t("navList", lang)}>
            <CartIcon size={17} />
            <BasketBadge as="cnt" />
          </Link>
        </div>
      </header>

    </>
  );
}
