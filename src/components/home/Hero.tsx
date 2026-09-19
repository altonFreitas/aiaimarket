"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import type { HeroSlide, Lang, Settings } from "@/lib/types";

/** How long a photo slide holds the screen. */
const AUTOPLAY_MS = 6000;
/** How long a video slide holds the screen when its length is not known --
 * a browser that refused to autoplay, a file that will not decode, a phone
 * on a data saver. Without a backstop a carousel can park on a black
 * rectangle forever, and nothing on screen would say why.
 *
 * Once the browser HAS read the file's metadata the slide waits for the
 * real duration instead (see `dwell` below); a fixed number here would cut
 * a 45-second film off at 20. */
const VIDEO_FALLBACK_MS = 20000;

/** And a ceiling on that, for a file whose metadata claims something
 * absurd. Five minutes is far longer than any shop banner and still
 * finite. */
const VIDEO_CEILING_MS = 5 * 60000;

/** A slide is a video when it names one. There is no media_type column to
 * disagree with the URL -- see supabase/hero-video.sql. */
function videoSrc(s: HeroSlide): string {
  return (s.video_url || "").trim();
}

/** HOW THIS SLIDE SITS IN THE FRAME, chosen per slide in /admin/hero.
 *
 * "contain" is the default and shows the whole picture: the hero is a tall
 * box on a phone and a wide band on a desktop, and everything this shop
 * puts here was shot on a phone, so filling the desktop band meant
 * throwing most of the picture away -- the reported symptom was a
 * horizontal slice of sky where the phone showed the whole clip. "cover"
 * stays for genuinely wide material, where letterboxing would cost space
 * for nothing.
 *
 * Anything that is not "cover" reads as "contain", which covers both a
 * database that has not run the latest supabase/hero-video.sql (no column
 * at all) and a value nobody recognises. Showing a whole picture in the
 * wrong shape is cosmetic; cropping one loses it. */
function fitOf(s: HeroSlide): "contain" | "cover" {
  return s.media_fit === "cover" ? "cover" : "contain";
}

/** Inline SVG visual — same "no photo yet" visual language as
 * lib/placeholder.ts (layered navy/amber shapes, zero network requests),
 * used as the hero's brand visual until the admin uploads real photos
 * or a video (see /admin/hero). */
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

/** Media carousel: photos, videos, or a mix, uploaded in /admin/hero.
 *
 * PHOTOS ALL RENDER, THE VIDEO ONLY WHEN IT IS SHOWING. Slide photos are
 * stacked and crossfaded, which costs one <img> each; a <video> costs a
 * download measured in megabytes, so only the active slide's video is ever
 * put in the document. On the mobile connections this store is built for,
 * that difference is the whole feature.
 *
 * HOW A VIDEO SLIDE HANDS OVER. It plays once and advances when it ends,
 * rather than being cut off mid-shot by a timer -- unless it is the only
 * slide, in which case it loops. A mixed set works the same way: photos
 * take their six seconds, videos take exactly as long as they are, and the
 * carousel goes round in the order set in /admin/hero.
 *
 * The timer is a backstop, not the mechanism. It is set to the video's own
 * duration once the browser reports it, and to VIDEO_FALLBACK_MS until
 * then -- so a video that never reports ending (autoplay refused, a file
 * that will not decode) still hands over, and one that is longer than the
 * fallback is not cut off at it.
 *
 * MUTED, AND SAYING SO. Autoplay with sound is refused by every browser and
 * resented by every visitor, so a hero video starts silent with the control
 * to unmute it sitting on the video. Someone who has asked their system for
 * reduced motion gets the poster frame and a play button instead, and the
 * carousel stops advancing on its own.
 *
 * Only the ACTIVE slide's headline/subtext/CTA are ever rendered, so there
 * is never a hidden-but-focusable link inside an aria-hidden slide. A
 * single visually-hidden <h1> keeps the page's heading hierarchy intact
 * regardless of whether any slide has a headline (a page should have
 * exactly one h1; slide headlines render as a styled paragraph instead,
 * since there can be several of them across slides). */
function SlideCarousel({ lang, settings, slides }: { lang: Lang; settings: Settings; slides: HeroSlide[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [reduced, setReduced] = useState(false);
  /** The active video's real length, once the browser has read it. Keyed by
   * slide id rather than reset on every change, so a stale reading from the
   * previous slide can never be mistaken for this one's -- and so nothing
   * has to call setState from an effect to clear it. */
  const [videoLen, setVideoLen] = useState<{ id: string; ms: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const active = slides[Math.min(i, slides.length - 1)];
  const src = videoSrc(active);
  const tagline = lang === "pt" ? settings.tagline_pt : lang === "en" ? settings.tagline_en : settings.tagline_tet;
  const srTitle = settings.store_name + (tagline ? " — " + tagline : "");

  const next = useCallback(() => setI((cur) => (cur + 1) % slides.length), [slides.length]);

  /* How long this slide gets. A photo gets a fixed turn; a video gets its
   * own length, because the point of a video slide is that it finishes. */
  const dwell = !src
    ? AUTOPLAY_MS
    : videoLen && videoLen.id === active.id ? videoLen.ms : VIDEO_FALLBACK_MS;

  // "Reduce motion" is a system setting, not a one-time reading: someone
  // can turn it on while the page is open, and the carousel should stop.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // One timeout per slide rather than a running interval: a manual jump
  // changes `i`, which re-runs this, which gives the new slide its full
  // turn on screen instead of whatever was left of the previous one's.
  useEffect(() => {
    if (slides.length < 2 || paused || reduced) return;
    const id = setTimeout(next, dwell);
    return () => clearTimeout(id);
  }, [i, paused, reduced, dwell, slides.length, next]);

  // React does not reliably set `muted` from the attribute, and an unmuted
  // autoplay is refused outright -- so the property is set on the element
  // itself before play() is ever called.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = muted;
    if (paused || reduced) { el.pause(); return; }
    // A refusal to autoplay is not an error worth reporting: the poster
    // frame is still there, and the play button still works.
    void el.play().catch(() => {});
  }, [i, muted, paused, reduced]);

  function goTo(nextIndex: number) {
    setI(((nextIndex % slides.length) + slides.length) % slides.length);
  }

  const showPlayPause = slides.length > 1 || src !== "";

  return (
    <section className="hero-carousel" aria-roledescription="carousel" aria-label={srTitle}>
      <h1 className="sr">{srTitle}</h1>

      {/* WHAT FILLS THE LETTERBOX, ALL OF THEM BEFORE ANY PICTURE.
          A contained picture leaves the rest of the frame empty, and empty
          reads as broken -- two black slabs either side of a phone photo
          look like the page failed to load something. The image itself,
          blown up and blurred, fills the band with its own colours.

          BEFORE, not behind with a z-index: these are all absolutely
          positioned with z-index auto, so tree order IS paint order.
          Lifting the pictures with a z-index instead would have lifted
          them over the headline overlay further down as well.

          ALL the fills first, then ALL the pictures, rather than each
          fill beside its own: interleaved, the next slide's fill paints
          over the last slide's picture, and both are half-visible during
          a crossfade.

          On a video slide this is the POSTER, not a second copy of the
          video: the poster is already downloaded and decoded, where a
          second <video> costs another decode on every device for scenery.
          A slide with no picture to blur keeps the dark ground behind it,
          which is what that case has always looked like. */}
      {slides.map((s, idx) => (
        fitOf(s) === "cover" || !s.image_url ? null : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={"fill-" + s.id} src={s.image_url} alt="" aria-hidden="true"
            className={"hero-slide-fill" + (idx === i ? " active" : "")} />
        )
      ))}

      {slides.map((s, idx) => (
        videoSrc(s) ? null : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={s.id} src={s.image_url} alt="" aria-hidden="true"
            className={"hero-slide-img" + (idx === i ? " active" : "")
              + (fitOf(s) === "cover" ? "" : " is-contain")} />
        )
      ))}

      {src && (
        <video
          key={active.id}
          ref={videoRef}
          /* HOW IT SITS IN THE FRAME -- see fitOf. */
          className={"hero-slide-img active hero-slide-video"
            + (fitOf(active) === "cover" ? "" : " is-contain")}
          poster={active.image_url || undefined}
          playsInline
          loop={slides.length === 1}
          preload="metadata"
          aria-hidden="true"
          tabIndex={-1}
          onLoadedMetadata={(e) => {
            const seconds = e.currentTarget.duration;
            if (!Number.isFinite(seconds) || seconds <= 0) return;
            // A second and a half of slack past the end, so the handover
            // happens on `ended` in the normal case and this only ever
            // catches a video that stalled on its last frame.
            setVideoLen({ id: active.id, ms: Math.min(seconds * 1000 + 1500, VIDEO_CEILING_MS) });
          }}
          onEnded={() => { if (slides.length > 1) next(); }}
        >
          <source src={src} />
        </video>
      )}


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

      <div className="hero-ctrls">
        {src !== "" && (
          <button type="button" className="hero-ctrl" onClick={() => setMuted((m) => !m)}
            aria-label={t(muted ? "heroUnmute" : "heroMute", lang)}>
            {muted ? <MutedIcon /> : <SoundIcon />}
          </button>
        )}
        {showPlayPause && (
          <button type="button" className="hero-ctrl" onClick={() => setPaused((p) => !p)}
            aria-label={t(paused ? "heroPlay" : "heroPause", lang)}>
            {paused ? <PlayIcon /> : <PauseIcon />}
          </button>
        )}
      </div>

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

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function SoundIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  );
}
function MutedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
      <path d="m16 9 5 6M21 9l-5 6" />
    </svg>
  );
}

export default function Hero({ lang, settings, slides }: { lang: Lang; settings: Settings; slides: HeroSlide[] }) {
  if (!slides.length) return <DefaultHero lang={lang} settings={settings} />;
  return <SlideCarousel lang={lang} settings={settings} slides={slides} />;
}
