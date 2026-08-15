import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasSellerTotpSession } from "@/lib/sellerTotpSession";
import AccountForm from "@/components/AccountForm";
import CustomerPanel from "@/components/CustomerPanel";
import SellerTotpVerifyForm from "@/components/SellerTotpVerifyForm";
import { getLang } from "@/lib/lang";
import type { Customer } from "@/lib/types";

/** The one unified entry point behind the header's person icon. Not
 * logged in -> the login/signup form. Logged in as a seller -> straight
 * to their existing dashboard, UNLESS they have 2FA enabled and haven't
 * cleared it yet this session, in which case this page shows the TOTP
 * step itself rather than redirecting (redirecting would just bounce
 * straight back here, since getCurrentSellerOrRedirect() in
 * lib/data/seller.ts enforces the exact same check on every /seller/*
 * page). Logged in as anyone else -> the plain customer panel. The
 * admin never reaches this page in a logged-in state at all — see
 * AccountForm, which routes an admin-email login attempt to
 * /admin/login before ever touching Supabase Auth. */
export default async function AccountPage() {
  const lang = await getLang();
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();

  if (!user) {
    return (
      <div className="wrap" style={{ maxWidth: 480 }}>
        <AccountForm lang={lang} />
      </div>
    );
  }

  const admin = supabaseAdmin();
  // select("*"), not an explicit column list -- so this keeps working
  // for an existing seller logging in even in the brief window before
  // apply-update-39.js's schema migration is deployed. An explicit list
  // naming totp_enabled would fail the WHOLE query while that column
  // doesn't exist yet, incorrectly treating every seller as if they had
  // no account at all.
  const { data: seller } = await admin.from("sellers").select("*").eq("user_id", user.id).maybeSingle();

  if (seller) {
    if (seller.totp_enabled) {
      const ok = await hasSellerTotpSession(seller.id);
      if (!ok) {
        return (
          <div className="wrap" style={{ maxWidth: 480 }}>
            <SellerTotpVerifyForm lang={lang} />
          </div>
        );
      }
    }
    redirect("/seller/dashboard");
  }

  const { data: customer } = await admin.from("customers").select("*").eq("user_id", user.id).maybeSingle();

  if (!customer) {
    // Edge case: a Supabase Auth session exists but the customers row
    // is missing (e.g. it failed to create for some reason). Sign them
    // out rather than crash — they can just log in again, which will
    // retry cleanly.
    await sb.auth.signOut();
    redirect("/account");
  }

  return (
    <div className="wrap" style={{ maxWidth: 480 }}>
      <CustomerPanel lang={lang} customer={customer as Customer} />
    </div>
  );
}
