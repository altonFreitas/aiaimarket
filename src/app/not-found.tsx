import Link from "next/link";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";

/* A 404 that looks like the shop.
 *
 * Next's built-in one is an unstyled "404 | This page could not be found"
 * with none of the site around it. A shopper following an old link to a
 * product that has been archived met that, and it reads as a broken site
 * rather than as one missing page. */
export default async function NotFound() {
  const lang = await getLang();
  return (
    <div className="wrap">
      <div className="empty">
        <h1>{t("notFoundTitle", lang)}</h1>
        <p>{t("notFoundBody", lang)}</p>
        <div className="empty-actions">
          <Link className="btn btn-amber" href="/">{t("goHome", lang)}</Link>
          <Link className="btn btn-ghost" href="/shop">{t("browse", lang)}</Link>
        </div>
      </div>
    </div>
  );
}
