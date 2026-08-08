import Link from "next/link";
import Image from "next/image";
import LangSwitch from "./LangSwitch";
import SearchBar from "./SearchBar";
import BasketBadge from "./BasketBadge";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import type { Settings } from "@/lib/types";

export default async function Header({ settings }: { settings: Settings }) {
  const lang = await getLang();
  return (
    <>
      <header className="hd">
        <div className="hd-in">
          <Link className="hd-logo" href="/" aria-label="Home">
            <Image src="/logo-mark.webp" alt="" width={280} height={115} priority style={{ height: 18, width: "auto" }} />
            <b>{settings.store_name}</b>
          </Link>
          <span className="hd-sp" />

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
          <Link className="icon-btn" href="/list" aria-label="List">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <path d="M3 6h18" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
            <BasketBadge as="cnt" />
          </Link>
        </div>
      </header>
      <div className="searchbar">
        <SearchBar lang={lang} />
      </div>
    </>
  );
}
