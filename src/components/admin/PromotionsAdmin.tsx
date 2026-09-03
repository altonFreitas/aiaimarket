"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useToast } from "@/components/Toast";
import { compressImage } from "@/lib/compressImage";
import {
  createPromotion, deletePromotion, movePromotion, togglePromotionActive,
  updatePromotion, uploadPromotionImage,
} from "@/lib/actions/promotions";
import { t } from "@/lib/i18n";
import WriteOnly from "./Access";
import type { Lang, Promotion } from "@/lib/types";

type Draft = Pick<Promotion, "title" | "badge_label" | "href">;

export default function PromotionsAdmin({ lang, promotions }: { lang: Lang; promotions: Promotion[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Partial<Draft>>>({});

  function draftFor(p: Promotion): Draft {
    return { title: p.title, badge_label: p.badge_label, href: p.href, ...drafts[p.id] };
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
    for (const file of Array.from(files).slice(0, 8)) {
      try {
        const r = await compressImage(file, 900, 200);
        const url = await uploadPromotionImage(r.data, file.name);
        await createPromotion({ title: file.name.replace(/\.\w+$/, ""), badgeLabel: "", imageUrl: url, href: "/shop" });
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
      <h1>{t("promotions", lang)}</h1>
      <p className="sub">{t("promotionsSub", lang)}</p>

      <div className="panel">
        <label className="btn btn-sm" style={{ display: "inline-flex", cursor: busy ? "not-allowed" : "pointer" }}>
          {t("addPromotion", lang)}
          <input type="file" accept="image/*" multiple hidden disabled={busy}
            onChange={(e) => onUpload(e.target.files)} />
        </label>
      </div>

      {!promotions.length && <p className="sub">{t("noPromotionsYet", lang)}</p>}

      <div className="list">
        {promotions.map((p, i) => {
          const d = draftFor(p);
          return (
            <div key={p.id} className="panel hero-slide-row" style={{ opacity: p.active ? 1 : 0.5 }}>
              <Image src={p.image_url} alt="" width={72} height={72} className="hero-slide-thumb"
                unoptimized={p.image_url.startsWith("data:")} />
              <div className="hero-slide-fields">
                <input placeholder={t("promoTileTitle", lang)} value={d.title}
                  onChange={(e) => setDraft(p.id, { title: e.target.value })} />
                <div style={{ display: "flex", gap: 6 }}>
                  <input placeholder={t("promoBadge", lang)} value={d.badge_label}
                    onChange={(e) => setDraft(p.id, { badge_label: e.target.value })} style={{ flex: 1 }} />
                  <input placeholder={t("promoHref", lang)} value={d.href}
                    onChange={(e) => setDraft(p.id, { href: e.target.value })} style={{ flex: 2 }} />
                </div>
              </div>
              <div className="hero-slide-acts"><WriteOnly>
                <button className="btn btn-sm btn-ghost" disabled={busy || i === 0}
                  onClick={() => run(() => movePromotion(p.id, -1))} aria-label={t("moveUp", lang)}>↑</button>
                <button className="btn btn-sm btn-ghost" disabled={busy || i === promotions.length - 1}
                  onClick={() => run(() => movePromotion(p.id, 1))} aria-label={t("moveDown", lang)}>↓</button>
                <button className="btn btn-sm" disabled={busy}
                  onClick={() => run(() => updatePromotion(p.id, {
                    title: d.title, badgeLabel: d.badge_label, href: d.href,
                  }), t("saved", lang))}>{t("save", lang)}</button>
                <button className="btn btn-sm btn-ghost" disabled={busy}
                  onClick={() => run(() => togglePromotionActive(p.id, !p.active))}>
                  {p.active ? t("hide", lang) : t("show", lang)}
                </button>
                <button className="btn btn-sm btn-danger" disabled={busy}
                  onClick={() => run(() => deletePromotion(p.id))}>{t("remove", lang)}</button>
              </WriteOnly></div>
            </div>
          );
        })}
      </div>
    </>
  );
}
