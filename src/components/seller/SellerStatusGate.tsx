import { t } from "@/lib/i18n";
import type { Lang, Seller } from "@/lib/types";

/** Gates seller-only capability (creating/editing products) behind
 * approval — used by /seller/products, NOT by /seller/settings (a
 * seller may fix their own profile info while still pending). */
export default function SellerStatusGate({
  seller, lang, children,
}: { seller: Seller; lang: Lang; children: React.ReactNode }) {
  if (seller.status === "approved") return <>{children}</>;
  return (
    <div className="panel">
      {seller.status === "pending" && (
        <>
          <h3>{t("sellerPendingTitle", lang)}</h3>
          <p className="sub">{t("sellerPendingMsg", lang)}</p>
        </>
      )}
      {seller.status === "rejected" && <p className="msg">{t("sellerRejectedMsg", lang)}</p>}
      {seller.status === "suspended" && <p className="msg">{t("sellerSuspendedMsg", lang)}</p>}
    </div>
  );
}
