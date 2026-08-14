import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveAccountKind } from "@/lib/actions/customer-auth";
import AccountForm from "@/components/AccountForm";
import CustomerPanel from "@/components/CustomerPanel";
import { getLang } from "@/lib/lang";
import type { Customer } from "@/lib/types";

/** The one unified entry point behind the header's person icon. Not
 * logged in -> the login/signup form. Logged in as a seller -> straight
 * to their existing dashboard (unaffected by any of this). Logged in as
 * anyone else -> the plain customer panel. The admin never reaches this
 * page in a logged-in state at all — see AccountForm, which routes an
 * admin-email login attempt to /admin/login before ever touching
 * Supabase Auth. */
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

  const kind = await resolveAccountKind(user.id);
  if (kind === "seller") redirect("/seller/dashboard");

  const admin = supabaseAdmin();
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
