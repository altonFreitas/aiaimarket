import Link from "next/link";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";

/** Where requireSellerFeature() sends a store that does not hold the part
 * of the app it asked for.
 *
 * A plain sentence with the tabs still above it, not an error. The store
 * has not done anything wrong and nothing is broken -- this simply is not
 * part of what they have, and the way to change that is a conversation
 * with the marketplace, which is what the text says.
 *
 * No guard of its own: it belongs to the dashboard feature, which every
 * seller holds. A refusal screen that could itself refuse you would be a
 * loop. */
export default async function SellerNoAccessPage() {
  const lang = await getLang();
  return (
    <div className="panel">
      <h1>{t("sellerNoAccessTitle", lang)}</h1>
      <p className="sub">{t("sellerNoAccessBody", lang)}</p>
      <div className="empty-actions">
        <Link className="btn btn-amber" href="/seller/dashboard">{t("sellerDashboard", lang)}</Link>
        <Link className="btn btn-ghost" href="/seller/products">{t("sellerProducts", lang)}</Link>
      </div>
    </div>
  );
}
