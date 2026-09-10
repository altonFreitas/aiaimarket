import RegisterForm from "@/components/seller/RegisterForm";
import { getLang } from "@/lib/lang";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { inviteState, INVITE_MESSAGE } from "@/lib/sellerInvites";
import { t } from "@/lib/i18n";

/** Registering a store is by invitation.
 *
 * The owner mints a link on the Sellers screen and sends it to the person
 * who asked (see supabase/seller-invites.sql for why that replaced a
 * checkbox that was either open to the whole internet or shut to
 * everybody).
 *
 * WHAT THIS PAGE DECIDES IS ONLY WHAT TO DRAW. The action behind the form
 * checks the same token again, because a form can be posted without ever
 * loading this page.
 *
 * The four refusals are four different sentences on purpose. "Used" and
 * "expired" send a person to two different places -- to sign in, or back
 * to the owner for a new link -- and one "invalid link" would send both of
 * them to the owner. */
export default async function SellerRegisterPage({
  searchParams,
}: { searchParams: Promise<{ invite?: string }> }) {
  const [lang, sp] = await Promise.all([getLang(), searchParams]);
  const token = (sp.invite || "").trim();

  // Read with the service role: seller_invites has RLS on and no policies,
  // so a token is never readable by anyone but the server.
  let row = null;
  if (token) {
    const { data } = await supabaseAdmin()
      .from("seller_invites").select("expires_at, used_at, revoked_at")
      .eq("token", token).maybeSingle();
    row = data;
  }
  const state = inviteState(row);

  if (state !== "ok") {
    return (
      <div className="wrap" style={{ maxWidth: 560 }}>
        <div className="panel">
          <h1>{t("sellerRegisterTitle", lang)}</h1>
          <p className="sub">{t("inviteOnly", lang)}</p>
          <p className="note warn">{t(INVITE_MESSAGE[state], lang)}</p>
          <p className="hint">{t("inviteOnlyHint", lang)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap" style={{ maxWidth: 560 }}>
      <RegisterForm lang={lang} inviteToken={token} />
    </div>
  );
}
