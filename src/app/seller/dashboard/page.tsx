import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import LogoutButton from "@/components/seller/LogoutButton";

/** Phase 0 dashboard: proves the whole loop (register -> pending ->
 * admin approves -> log in -> see approved state) actually works end to
 * end. Products/orders/earnings are later phases, deliberately not here
 * yet -- see the multi-vendor plan. */
export default async function SellerDashboardPage() {
  const lang = await getLang();
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/seller/login"); // proxy.ts already guards this; belt and suspenders

  const admin = supabaseAdmin();
  const { data: seller } = await admin.from("sellers").select("*").eq("user_id", user.id).maybeSingle();

  if (!seller) {
    return (
      <div className="wrap">
        <div className="panel">
          <p className="sub">No seller profile found for this account.</p>
          <LogoutButton lang={lang} />
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <h1 style={{ margin: 0 }}>{seller.store_name}</h1>
          <LogoutButton lang={lang} />
        </div>

        {seller.status === "pending" && (
          <>
            <h3>{t("sellerPendingTitle", lang)}</h3>
            <p className="sub">{t("sellerPendingMsg", lang)}</p>
          </>
        )}
        {seller.status === "rejected" && <p className="msg">{t("sellerRejectedMsg", lang)}</p>}
        {seller.status === "suspended" && <p className="msg">{t("sellerSuspendedMsg", lang)}</p>}
        {seller.status === "approved" && (
          <>
            <p className="sub">{t("sellerApprovedWelcome", lang)}</p>
            <p className="sub">{t("sellerDashboardComingSoon", lang)}</p>
          </>
        )}
      </div>
    </div>
  );
}
