import Link from "next/link";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export default function PromoBanner({ lang }: { lang: Lang }) {
  return (
    <section className="promo">
      <div>
        <h2>{t("promoTitle", lang)}</h2>
        <p>{t("promoSub", lang)}</p>
      </div>
      <Link className="btn btn-amber" href="/shop">{t("promoCta", lang)}</Link>
    </section>
  );
}
