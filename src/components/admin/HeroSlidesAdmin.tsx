"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { compressImage } from "@/lib/compressImage";
import {
  createHeroSlide, deleteHeroSlide, moveHeroSlide, updateHeroSlide, uploadHeroImage,
} from "@/lib/actions/hero";
import { t } from "@/lib/i18n";
import WriteOnly from "./Access";
import type { HeroSlide, Lang } from "@/lib/types";

type Draft = Pick<HeroSlide, "headline" | "subtext" | "cta_label" | "cta_href">;

export default function HeroSlidesAdmin({ lang, slides }: { lang: Lang; slides: HeroSlide[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Partial<Draft>>>({});

  function draftFor(s: HeroSlide): Draft {
    return {
      headline: s.headline, subtext: s.subtext, cta_label: s.cta_label, cta_href: s.cta_href,
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

  return (
    <>
      <h1>{t("heroSlides", lang)}</h1>
      <p className="sub">{t("heroSlidesSub", lang)}</p>

      <div className="panel">
        <label className="btn btn-sm" style={{ display: "inline-flex", cursor: busy ? "not-allowed" : "pointer" }}>
          {t("addSlide", lang)}
          <input type="file" accept="image/*" multiple hidden disabled={busy}
            onChange={(e) => onUpload(e.target.files)} />
        </label>
      </div>

      {!slides.length && <p className="sub">{t("noSlidesYet", lang)}</p>}

      <div className="list">
        {slides.map((s, i) => {
          const d = draftFor(s);
          return (
            <div key={s.id} className="panel hero-slide-row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.image_url} alt="" className="hero-slide-thumb" />
              <div className="hero-slide-fields">
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
