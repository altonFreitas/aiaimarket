// import Link from "next/link";
import { t } from "@/lib/i18n";
import type { Lang, Settings } from "@/lib/types";

/** The thin utility strip above the main header — store info + a quick
 * link to order tracking, the pattern most dense marketplace sites (Fnac
 * included) use to surface "delivery info / help / track" without
 * competing with the header's own nav for space. Text-only and tiny, so it
 * costs near nothing on the data-frugality budget this store is built
 * around. Hidden on narrow screens: the same tracking link already lives
 * in the bottom nav there, and the delivery note doesn't earn its space on
 * a 360px screen. */
export default function TopBar({ lang, settings }: { lang: Lang; settings: Settings }) {
  return (
    <div className="topbar">
      <div className="topbar-in">
        <span className="topbar-note">{t("freeDelivery", lang)}</span>
        <span className="topbar-sp" />
        {/* <Link className="topbar-link" href="/track">{t("trackOrder", lang)}</Link> */}
        {settings.hours && <span className="topbar-note topbar-hours">{settings.hours}</span>}
      </div>
    </div>
  );
}
