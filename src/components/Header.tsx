import Link from "next/link";
import Image from "next/image";
import LangSwitch from "./LangSwitch";
import BasketBadge from "./BasketBadge";
import SearchBar from "./SearchBar";
import MegaNav from "./MegaNav";
import MobileNav from "./MobileNav";
import { getCategories, getLiveProducts } from "@/lib/data/public";
import { buildNav } from "@/lib/nav";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import type { Settings } from "@/lib/types";

export default async function Header({ settings }: { settings: Settings }) {
  const lang = await getLang();
  // Both reads are cached across requests and deduped within one (see
  // lib/data/public.ts), so putting the navigation in the header costs the
  // pages that already load them nothing at all -- and one shared query
  // every few minutes for the ones that did not.
  const [cats, products] = await Promise.all([getCategories(), getLiveProducts()]);
  const navRoots = buildNav(cats, products, lang);
  return (
    <>
      <header className="hd">
        <div className="hd-in">
          {/* Phone only: the menu and search that replace the category row
              and the search strip below the header. Hidden from 768px up,
              where MegaNav's bar and .hd-search do the same jobs with room
              to spell them out. */}
          <MobileNav roots={navRoots} lang={lang} />

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
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            {t("navTrack", lang)}
          </Link>

          <LangSwitch current={lang} />
          <Link className="icon-btn" href="/account" aria-label={t("myAccount", lang)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
            </svg>
          </Link>
          <Link className="icon-btn hd-cart" href="/list" aria-label={t("navList", lang)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <path d="M3 6h18" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
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
