"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import type { HeroSlide, Lang, Settings } from "@/lib/types";

const AUTOPLAY_MS = 5000;

/** Inline SVG visual — same "no photo yet" visual language as
 * lib/placeholder.ts (layered navy/amber shapes, zero network requests),
 * used as the hero's brand visual until the admin uploads real photos
 * (see /admin/hero). */
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

/** Default hero: no slides configured yet in /admin/hero. Same layout
 * this project shipped with before the carousel existed. */
function DefaultHero({ lang, settings }: { lang: Lang; settings: Settings }) {
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

/** Photo carousel: one or more slides uploaded in /admin/hero. Slide
 * images always crossfade in the background; only the *active* slide's
 * headline/subtext/CTA are ever rendered, so there's never a hidden-but-
 * focusable link sitting in an aria-hidden slide. A single visually-
 * hidden <h1> keeps the page's heading hierarchy intact regardless of
 * whether any slide has a headline (SEO/accessibility — a page should
 * have exactly one h1; slide headlines render as a styled paragraph
 * instead, not literal heading tags, since there can be several of them
 * across slides). */
function SlideCarousel({ lang, settings, slides }: { lang: Lang; settings: Settings; slides: HeroSlide[] }) {
  const [i, setI] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const active = slides[i];
  const tagline = lang === "pt" ? settings.tagline_pt : lang === "en" ? settings.tagline_en : settings.tagline_tet;
  const srTitle = settings.store_name + (tagline ? " — " + tagline : "");

  useEffect(() => {
    if (slides.length < 2) return;
    timer.current = setInterval(() => setI((cur) => (cur + 1) % slides.length), AUTOPLAY_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [slides.length]);

  function goTo(next: number) {
    if (timer.current) clearInterval(timer.current);
    setI(((next % slides.length) + slides.length) % slides.length);
    if (slides.length > 1) {
      timer.current = setInterval(() => setI((cur) => (cur + 1) % slides.length), AUTOPLAY_MS);
    }
  }

  return (
    <section className="hero-carousel" aria-roledescription="carousel" aria-label={srTitle}>
      <h1 className="sr">{srTitle}</h1>

      {slides.map((s, idx) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={s.id} src={s.image_url} alt="" aria-hidden="true"
          className={"hero-slide-img" + (idx === i ? " active" : "")} />
      ))}

      {(active.headline || active.subtext || (active.cta_label && active.cta_href)) && (
        <div className="hero-slide-overlay">
          <div className="hero-slide-content">
            {active.headline && <p className="hero-slide-h">{active.headline}</p>}
            {active.subtext && <p className="hero-slide-sub">{active.subtext}</p>}
            {active.cta_label && active.cta_href && (
              <Link className="btn btn-amber" href={active.cta_href}>{active.cta_label}</Link>
            )}
          </div>
        </div>
      )}

      {slides.length > 1 && (
        <>
          <button type="button" className="hero-arrow hero-arrow-prev" onClick={() => goTo(i - 1)}
            aria-label={t("heroPrevSlide", lang)}>‹</button>
          <button type="button" className="hero-arrow hero-arrow-next" onClick={() => goTo(i + 1)}
            aria-label={t("heroNextSlide", lang)}>›</button>
          <div className="hero-dots">
            {slides.map((s, idx) => (
              <button key={s.id} type="button" className={"hero-dot" + (idx === i ? " active" : "")}
                onClick={() => goTo(idx)} aria-label={`${t("heroSlideLabel", lang)} ${idx + 1}`} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default function Hero({ lang, settings, slides }: { lang: Lang; settings: Settings; slides: HeroSlide[] }) {
  if (!slides.length) return <DefaultHero lang={lang} settings={settings} />;
  return <SlideCarousel lang={lang} settings={settings} slides={slides} />;
}
