import Link from "next/link";
import { placeholder } from "@/lib/placeholder";
import { money } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { Product } from "@/lib/types";
import type { Lang } from "@/lib/types";

const BADGE = { in: ["b-in", "stockIn"], low: ["b-low", "stockLow"], out: ["b-out", "stockOut"] } as const;

export default function ProductCard({ p, lang }: { p: Product; lang: Lang }) {
  const [cls, key] = BADGE[p.stock_status];
  const img = p.images?.[0] || placeholder(p.name);
  const loc = p.suku || p.municipality || "";
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
        <div className="pr">{money(p.price)}</div>
      </div>
    </Link>
  );
}
