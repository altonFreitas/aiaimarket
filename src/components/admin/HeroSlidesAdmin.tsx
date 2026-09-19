"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { compressImage } from "@/lib/compressImage";
import { supabaseBrowser } from "@/lib/supabase/browser";
import {
  createHeroSlide, createHeroVideoUpload, deleteHeroSlide, moveHeroSlide, updateHeroSlide, uploadHeroImage,
} from "@/lib/actions/hero";
import { t } from "@/lib/i18n";
import WriteOnly from "./Access";
import type { HeroSlide, Lang } from "@/lib/types";

type Draft = Pick<HeroSlide, "headline" | "subtext" | "cta_label" | "cta_href" | "video_fit">;

export default function HeroSlidesAdmin({ lang, slides }: { lang: Lang; slides: HeroSlide[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Partial<Draft>>>({});

  function draftFor(s: HeroSlide): Draft {
    return {
      headline: s.headline, subtext: s.subtext, cta_label: s.cta_label, cta_href: s.cta_href,
      // A database that has not run the latest hero-video.sql has no
      // column, and absent means "show the whole video" -- the same
      // reading the storefront takes.
      video_fit: s.video_fit ?? "contain",
      ...drafts[s.id],
    };
  }
  function setDraft(id: string, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  async function run(fn: () => Promise<unknown>, msg?: string) {
    setBusy(true);
    try { await fn(); if (msg) toast(msg); router.refresh(); }
    catch (e) { toast(String((e as Error).message), true); }
    setBusy(false);
  }

  async function onUpload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    for (const file of Array.from(files).slice(0, 6)) {
      try {
        const r = await compressImage(file, 1600, 300); // wider/heavier ceiling than product photos — hero banners render large
        const url = await uploadHeroImage(r.data, file.name);
        await createHeroSlide(url);
        toast(`${file.name} → ${r.kb} KB`);
      } catch (e) {
        toast(String((e as Error).message), true);
      }
    }
    router.refresh();
    setBusy(false);
  }

  /** A video never passes through the server.
   *
   * The action hands back a token good for exactly one Storage path, the
   * browser PUTs the file straight there, and only the resulting URL comes
   * back through an action. That is the only shape that works: a Server
   * Action carries its arguments in the request body, and no video worth
   * showing fits in one. */
  async function onUploadVideo(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const { path, token, publicUrl } = await createHeroVideoUpload(file.name, file.type, file.size);
      const { error } = await supabaseBrowser()
        .storage.from("product-images")
        .uploadToSignedUrl(path, token, file);
      if (error) throw error;
      await createHeroSlide("", publicUrl);
      toast(`${file.name} → ${Math.round(file.size / 1024)} KB`);
      router.refresh();
    } catch (e) {
      toast(String((e as Error).message), true);
    }
    setBusy(false);
  }

  /** The still frame behind a video: what a visitor sees while it loads,
   * and all a visitor on a metered connection may ever see. Same
   * compression path as a photo slide. */
  async function onUploadPoster(slideId: string, files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const r = await compressImage(file, 1600, 300);
      const url = await uploadHeroImage(r.data, file.name);
      await updateHeroSlide(slideId, { image_url: url });
      toast(`${file.name} → ${r.kb} KB`);
      router.refresh();
    } catch (e) {
      toast(String((e as Error).message), true);
    }
    setBusy(false);
  }

  return (
    <>
      <h1>{t("heroSlides", lang)}</h1>
      <p className="sub">{t("heroSlidesSub", lang)}</p>

      <div className="panel" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label className="btn btn-sm" style={{ display: "inline-flex", cursor: busy ? "not-allowed" : "pointer" }}>
          {t("addSlide", lang)}
          <input type="file" accept="image/*" multiple hidden disabled={busy}
            onChange={(e) => onUpload(e.target.files)} />
        </label>
        <label className="btn btn-sm" style={{ display: "inline-flex", cursor: busy ? "not-allowed" : "pointer" }}>
          {t("addVideoSlide", lang)}
          {/* .mov as well as the type: Safari reports video/quicktime, but
              some browsers hand over an empty type for the same file and
              would then grey it out in the picker. */}
          <input type="file" accept="video/mp4,video/webm,video/quicktime,.mov" hidden disabled={busy}
            onChange={(e) => onUploadVideo(e.target.files)} />
        </label>
        <p className="hint" style={{ margin: 0, flexBasis: "100%" }}>{t("heroVideoHint", lang)}</p>
      </div>

      {!slides.length && <p className="sub">{t("noSlidesYet", lang)}</p>}

      <div className="list">
        {slides.map((s, i) => {
          const d = draftFor(s);
          const video = (s.video_url || "").trim();
          return (
            <div key={s.id} className="panel hero-slide-row">
              {video ? (
                <video className="hero-slide-thumb" src={video} poster={s.image_url || undefined}
                  muted playsInline preload="metadata" controls />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.image_url} alt="" className="hero-slide-thumb" />
              )}
              <div className="hero-slide-fields">
                <p className="hero-slide-kind">
                  {t(video ? "slideKindVideo" : "slideKindPhoto", lang)}
                </p>
                <input placeholder={t("slideHeadline", lang)} value={d.headline}
                  onChange={(e) => setDraft(s.id, { headline: e.target.value })} />
                <input placeholder={t("slideSubtext", lang)} value={d.subtext}
                  onChange={(e) => setDraft(s.id, { subtext: e.target.value })} />
                <div style={{ display: "flex", gap: 6 }}>
                  <input placeholder={t("slideCtaLabel", lang)} value={d.cta_label}
                    onChange={(e) => setDraft(s.id, { cta_label: e.target.value })} style={{ flex: 1 }} />
                  <input placeholder={t("slideCtaHref", lang)} value={d.cta_href}
                    onChange={(e) => setDraft(s.id, { cta_href: e.target.value })} style={{ flex: 1 }} />
                </div>
                {video && (
                  <WriteOnly>
                    <label className="btn btn-sm btn-ghost"
                      style={{ display: "inline-flex", alignSelf: "flex-start", cursor: busy ? "not-allowed" : "pointer" }}>
                      {s.image_url ? t("slideReplacePoster", lang) : t("slideAddPoster", lang)}
                      <input type="file" accept="image/*" hidden disabled={busy}
                        onChange={(e) => onUploadPoster(s.id, e.target.files)} />
                    </label>

                    {/* HOW THIS ONE SITS IN THE HERO. The frame is a tall
                        box on a phone and a wide band on a desktop, and a
                        video cannot be both -- so the choice is the
                        owner's, per slide, rather than one rule the shop
                        has to live with. It saves with the Save button
                        beside the other fields. */}
                    <div className="hero-fit">
                      <span className="hero-fit-hd">{t("slideVideoFit", lang)}</span>
                      {(["contain", "cover"] as const).map((fit) => (
                        <label key={fit} className="hero-fit-opt">
                          <input type="radio" name={`fit-${s.id}`} value={fit}
                            checked={(d.video_fit ?? "contain") === fit} disabled={busy}
                            onChange={() => setDraft(s.id, { video_fit: fit })} />
                          <span>{t(fit === "contain" ? "slideFitWhole" : "slideFitFill", lang)}</span>
                        </label>
                      ))}
                      <p className="hint" style={{ margin: 0, flexBasis: "100%" }}>
                        {t("slideVideoFitHint", lang)}
                      </p>
                    </div>
                  </WriteOnly>
                )}
              </div>
              <div className="hero-slide-acts"><WriteOnly>
                <button className="btn btn-sm btn-ghost" disabled={busy || i === 0}
                  onClick={() => run(() => moveHeroSlide(s.id, -1))} aria-label={t("moveUp", lang)}>↑</button>
                <button className="btn btn-sm btn-ghost" disabled={busy || i === slides.length - 1}
                  onClick={() => run(() => moveHeroSlide(s.id, 1))} aria-label={t("moveDown", lang)}>↓</button>
                <button className="btn btn-sm" disabled={busy}
                  onClick={() => run(() => updateHeroSlide(s.id, d), t("saved", lang))}>{t("save", lang)}</button>
                <button className="btn btn-sm btn-danger" disabled={busy}
                  onClick={() => run(() => deleteHeroSlide(s.id))}>{t("remove", lang)}</button>
              </WriteOnly></div>
            </div>
          );
        })}
      </div>
    </>
  );
}
