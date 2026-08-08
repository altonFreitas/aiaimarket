"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBasket } from "@/lib/useBasket";
import { useToast } from "@/components/Toast";
import { bumpWaClickAction } from "@/lib/actions/track";
import { money, waLink, waProductMsg } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Lang, Product, Settings } from "@/lib/types";

const STOCK_CLS = { in: "stock-in", low: "stock-low", out: "stock-out" } as const;
const STOCK_KEY = { in: "stockIn", low: "stockLow", out: "stockOut" } as const;

function WaIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 2a8 8 0 1 1-4.1 14.8l-.3-.2-2.6.7.7-2.5-.2-.3A8 8 0 0 1 12 4zm-3.2 4c-.2 0-.5.1-.7.4-.3.3-.9.9-.9 2.1 0 1.2.9 2.4 1 2.6.1.2 1.7 2.8 4.3 3.8 2.1.8 2.5.7 3 .6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.7-.4-1.4-.7c-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1-.2-.1-1-.4-1.9-1.2-.7-.6-1.2-1.4-1.3-1.6-.1-.2 0-.3.1-.4l.4-.5.3-.5v-.4l-.7-1.6c-.2-.4-.4-.4-.5-.4h-.1z" />
    </svg>
  );
}

export default function ProductInteractive({
  p, settings, lang, siteOrigin,
}: { p: Product; settings: Settings; lang: Lang; siteOrigin: string }) {
  const [size, setSize] = useState<string | null>(p.sizes?.length === 1 ? p.sizes[0] : null);
  const [qty, setQty] = useState(1);
  const { add } = useBasket();
  const { toast } = useToast();

  const siteUrl = (path: string) => `${siteOrigin}${path}`;
  const waDigits = settings.wa_number.replace(/[^\d]/g, "");
  const msg = waProductMsg(p, size, qty, siteUrl);
  const href = waLink(waDigits, msg);

  const loc = {
    municipality: p.municipality || settings.municipality,
    post: p.post || settings.post,
    suku: p.suku || settings.suku,
    landmark: p.landmark || settings.landmark,
  };

  const payList: Array<[boolean, string]> = [
    [p.pay_cod, "pm_cod"], [p.pay_cop, "pm_cop"], [p.pay_bank, "pm_bank"],
    [p.pay_wallet, "pm_wallet"],
  ];

  function addToList() {
    if (p.sizes?.length > 1 && !size) {
      toast(t("chooseSize", lang), true);
      return;
    }
    add({ id: p.id, name: p.name, size: size || p.sizes?.[0] || "", price: Number(p.price), qty });
    toast(`${p.name} → ${t("list", lang)}`);
  }

  const router = useRouter();
  function buyNow() {
    if (p.sizes?.length > 1 && !size) {
      toast(t("chooseSize", lang), true);
      return;
    }
    add({ id: p.id, name: p.name, size: size || p.sizes?.[0] || "", price: Number(p.price), qty });
    router.push("/checkout");
  }

  async function share() {
    const caption =
      `${p.name} — ${money(p.price)}\n` +
      `${t("qStock", lang)} ${t(STOCK_KEY[p.stock_status], lang)}\n` +
      `${t("qHow", lang)} WhatsApp ${settings.wa_number}\n` +
      siteUrl(`/p/${p.slug}`);
    if (navigator.share) {
      try { await navigator.share({ title: p.name, text: caption, url: siteUrl(`/p/${p.slug}`) }); } catch {}
      return;
    }
    try {
      await navigator.clipboard.writeText(caption);
      toast(t("copied", lang));
    } catch {
      toast(t("copied", lang));
    }
  }

  return (
    <>
      {/* D3 — the four repeated questions, answered above the fold */}
      <section className="aab" aria-label={t("answers", lang)}>
        <div className="aab-hd">
          <span className="dot" />
          {t("answers", lang)}
        </div>

        <div className="aab-row">
          <div className="aab-q">{t("qPrice", lang)}</div>
          <div className="aab-a">
            <span className="aab-price">{money(p.price)}</span>
            <em style={{ fontStyle: "normal", fontSize: 12, color: "var(--muted)", marginLeft: 6 }}>USD</em>
          </div>
        </div>

        <div className="aab-row">
          <div className="aab-q">{t("qSize", lang)}</div>
          <div className="aab-a">
            {p.sizes?.length ? (
              <div className="sizes">
                {p.sizes.map((s) => (
                  <button key={s} type="button" aria-pressed={size === s} onClick={() => setSize(s)}>
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <span>—</span>
            )}
          </div>
        </div>

        <div className="aab-row">
          <div className="aab-q">{t("qStock", lang)}</div>
          <div className={"aab-a " + STOCK_CLS[p.stock_status]}>
            {t(STOCK_KEY[p.stock_status], lang)}
            {p.stock_status !== "out" && p.qty ? (
              <small>{p.qty} {t("unitsLeft", lang)}</small>
            ) : null}
          </div>
        </div>

        <div className="aab-row">
          <div className="aab-q">{t("qWhere", lang)}</div>
          <div className="aab-a">
            {loc.suku}, {loc.post}, {loc.municipality}
            <small>{loc.landmark} · {settings.hours}</small>
          </div>
        </div>

        <div className="aab-row">
          <div className="aab-q">{t("qHow", lang)}</div>
          <div className="aab-a">
            WhatsApp {settings.wa_number}
            <small>{t("noAccount", lang)}</small>
          </div>
        </div>

        {p.tags?.length > 0 && (
          <div className="aab-row">
            <div className="aab-q">{t("qUse", lang)}</div>
            <div className="aab-a">
              <div className="tags">
                {p.tags.map((g) => (
                  <a key={g} className="tag" href={`/search?q=${encodeURIComponent(g)}`}>
                    {g}
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="btn-row">
        {p.stock_status === "out" ? (
          <button className="btn" disabled>{t("stockOut", lang)}</button>
        ) : (
          <button className="btn btn-amber" type="button" onClick={buyNow}>
            {t("buyNow", lang)}
          </button>
        )}
      </div>

      <div className="btn-row">
        {p.stock_status === "out" ? null : (
          <>
            <a
              className="btn btn-wa"
              href={href}
              target="_blank"
              rel="noopener"
              onClick={() => { void bumpWaClickAction(p.id); }}
            >
              <WaIcon />
              {t("orderWa", lang)}
            </a>
            <button className="btn btn-ghost" type="button" onClick={addToList}>
              {t("addList", lang)}
            </button>
          </>
        )}
      </div>

      <div className="btn-row" style={{ flexDirection: "row", gap: 8 }}>
        <div className="qty" role="group" aria-label={t("qty", lang)}>
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="-">−</button>
          <span>{qty}</span>
          <button type="button" onClick={() => setQty((q) => q + 1)} aria-label="+">+</button>
        </div>
        <button className="btn btn-ghost" type="button" onClick={share} style={{ flex: 1 }}>
          {t("share", lang)}
        </button>
      </div>

      <div className="panel">
        <h3>{t("payAccepted", lang)}</h3>
        <div className="rows">
          {payList.filter(([on]) => on).map(([, key]) => (
            <div className="kv" key={key}>
              <span>{t(key, lang)}</span>
              <span className="pill ok">✓</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
