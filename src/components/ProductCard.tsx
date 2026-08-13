"use client";
import type { MouseEvent } from "react";
import Link from "next/link";
import { placeholder } from "@/lib/placeholder";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { useBasket } from "@/lib/useBasket";
import { useToast } from "@/components/Toast";
import type { Product } from "@/lib/types";
import type { Lang } from "@/lib/types";

const BADGE = { in: ["b-in", "stockIn"], low: ["b-low", "stockLow"], out: ["b-out", "stockOut"] } as const;

export default function ProductCard({ p, lang, sellerName }: { p: Product; lang: Lang; sellerName?: string }) {
  const [cls, key] = BADGE[p.stock_status];
  const img = p.images?.[0] || placeholder(p.name);
  const loc = p.suku || p.municipality || "";
  const { add } = useBasket();
  const { toast } = useToast();

  // Adds the product straight to the list from the catalog grid - no need
  // to open the product page first. Stops the click from also following
  // the card's <Link> to the product page.
  function addToList(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    add({ id: p.id, name: p.name, size: p.sizes?.[0] || "", price: Number(p.price), qty: 1,
      seller_id: p.seller_id, sellerName: sellerName || null });
    toast(`${p.name} → ${t("list", lang)}`);
  }

  return (
    <Link className={"card" + (p.stock_status === "out" ? " is-out" : "")} href={`/p/${p.slug}`}>
      <div className="ph">
        <span className={"badge " + cls}>{t(key, lang)}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt={p.name} loading="lazy" width={400} height={400} />
      </div>
      <div className="body">
        <div className="nm">{p.name}</div>
        <div className="mt">{loc}</div>
        {sellerName && <div className="sold-by">{t("soldBy", lang)} {sellerName}</div>}
        <div className="pr">{money(p.price)}</div>
        {p.stock_status !== "out" && (
          <button type="button" className="btn btn-sm btn-ghost card-add" onClick={addToList}>
            {t("addList", lang)}
          </button>
        )}
      </div>
    </Link>
  );
}
