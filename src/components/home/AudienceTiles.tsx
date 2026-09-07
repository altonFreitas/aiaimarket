import Link from "next/link";
import Image from "next/image";
import { placeholder } from "@/lib/placeholder";
import { t } from "@/lib/i18n";
import type { NavRoot } from "@/lib/nav";
import type { Lang } from "@/lib/types";

/** The two doors a clothing shopper walks through: Women and Men.
 *
 * The same entries as the main navigation bar (both come from buildNav's
 * rules in lib/nav.ts), given the space they deserve on a homepage instead
 * of only living behind a hover. A shop that has not said who anything is
 * for gets nothing here rather than two empty doors -- which is also the
 * cue to the owner that products need an audience set on them, since the
 * section appears by itself the moment one does.
 *
 * The picture on each tile is a real product from behind it, not stock
 * photography: this store has no art department, and a tile showing what is
 * actually in the shop is more honest than one showing what is not. */
export default function AudienceTiles({ roots, lang }: { roots: NavRoot[]; lang: Lang }) {
  if (!roots.length) return null;
  return (
    <section className="home-section">
      <div className="home-section-hd">
        <div>
          <h2>{t("shopByAudience", lang)}</h2>
          <p className="home-section-sub">{t("shopByAudienceSub", lang)}</p>
        </div>
      </div>
      <div className="aud-tiles">
        {roots.map((r) => {
          const img = r.feature[0]?.image || placeholder(r.label);
          return (
            <Link key={r.id} href={r.href} className="aud-tile">
              <Image src={img} alt="" width={640} height={420}
                sizes="(max-width: 700px) 100vw, 50vw"
                unoptimized={img.startsWith("data:")} />
              <span className="aud-tile-in">
                <b>{r.label}</b>
                <em>{r.count} {t("results", lang)}</em>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
