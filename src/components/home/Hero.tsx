import Link from "next/link";
import { t } from "@/lib/i18n";
import type { Lang, Settings } from "@/lib/types";

/** Inline SVG visual — same "no photo yet" visual language as
 * lib/placeholder.ts (layered navy/amber shapes, zero network requests),
 * used here as the hero's brand visual instead of a stock photo the
 * project doesn't have. */
function HeroArt() {
  return (
    <svg viewBox="0 0 480 480" role="img" aria-hidden="true" style={{ width: "100%", height: "auto" }}>
      <rect width="480" height="480" rx="18" fill="#152341" />
      <circle cx="340" cy="140" r="130" fill="#3d5a99" opacity=".5" />
      <circle cx="120" cy="360" r="90" fill="#f2b705" opacity=".85" />
      <path d="M0 480 L480 300 L480 480 Z" fill="#fff" opacity=".06" />
      <circle cx="240" cy="240" r="70" fill="none" stroke="#fff" strokeOpacity=".25" strokeWidth="2" />
    </svg>
  );
}

export default function Hero({ lang, settings }: { lang: Lang; settings: Settings }) {
  const tagline = lang === "pt" ? settings.tagline_pt : lang === "en" ? settings.tagline_en : settings.tagline_tet;
  return (
    <section className="hero">
      <div className="hero-copy">
        <h1>{t("heroTitle", lang)}</h1>
        <p className="hero-sub">{tagline || t("heroSub", lang)}</p>
        <div className="hero-cta">
          <Link className="btn btn-amber" href="/shop">{t("heroShopNow", lang)}</Link>
          <a className="btn btn-ghost" href="#new-arrivals">{t("heroNewArrivals", lang)}</a>
        </div>
      </div>
      <div className="hero-art">
        <HeroArt />
      </div>
    </section>
  );
}
