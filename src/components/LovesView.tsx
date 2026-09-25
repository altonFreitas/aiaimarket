"use client";
import Link from "next/link";
import ProductCard from "./ProductCard";
import HeartIcon from "./HeartIcon";
import { useLoves } from "@/lib/useLoves";
import { t } from "@/lib/i18n";
import type { Lang, Product } from "@/lib/types";

/** The loved products, filtered in the browser that knows which they are.
 *
 * ORDERED BY WHEN THEY WERE LOVED, newest first, not by the catalogue's
 * order: the list is a memory of what somebody did, and the thing they
 * hearted a minute ago is the one they came back for. useLoves keeps the
 * ids in the order they were added, so this is a lookup rather than a
 * sort.
 *
 * NOTHING RENDERS UNTIL THE LOCAL LIST HAS BEEN READ. `ready` is false for
 * the first paint -- the server sent markup that cannot know what this
 * browser saved -- and showing "nothing saved yet" during it would be a
 * wrong answer that flashes on every visit.
 */
export default function LovesView({
  lang, products, sellerNames,
}: {
  lang: Lang;
  products: Product[];
  sellerNames: Record<string, string | undefined>;
}) {
  const { ids, ready } = useLoves();

  const byId = new Map(products.map((p) => [p.id, p]));
  /* A loved product that has since been archived, sold out of the
     catalogue or unpublished simply is not here. Dropped rather than
     drawn as a dead card: the list is "things you can still buy", and a
     card linking to a 404 is worse than one fewer card. */
  const loved = ids.map((id) => byId.get(id)).filter((p): p is Product => !!p);

  if (!ready) {
    // Deliberately blank, not a spinner: the read is synchronous and this
    // lasts one frame. A spinner that appears for 16ms is a flicker.
    return <div className="wrap" aria-busy="true" />;
  }

  return (
    <div className="wrap">
      <h1>{t("lovesTitle", lang)}</h1>

      {loved.length === 0 ? (
        <div className="panel empty-loves">
          <HeartIcon size={42} />
          <p>{t("lovesEmpty", lang)}</p>
          <p className="hint">{t("lovesEmptyHint", lang)}</p>
          <Link className="btn btn-amber" href="/shop">{t("navShopAll", lang)}</Link>
        </div>
      ) : (
        <>
          <p className="count">{loved.length} {t("results", lang)}</p>
          <div className="grid">
            {loved.map((p) => (
              <ProductCard key={p.id} p={p} lang={lang}
                sellerName={sellerNames[p.seller_id]} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
