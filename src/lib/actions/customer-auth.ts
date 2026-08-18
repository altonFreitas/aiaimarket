"use server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** True only for the one hardcoded owner account (see lib/session.ts) --
 * checked BEFORE anything touches Supabase Auth, since the admin never
 * has (and shouldn't need) an auth.users row. This is what lets the one
 * unified /account entry point route an admin login to the existing,
 * already-secure TOTP flow instead of treating them like anyone else.
 * Async because every export from a "use server" file must be — this
 * is called directly from the client form. */
export async function isAdminEmail(email: string): Promise<boolean> {
  const configured = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  // Unconfigured must never match — otherwise "" === "" routes an empty
  // login straight into the admin TOTP flow.
  if (!configured) return false;
  return email.trim().toLowerCase() === configured;
}

/** Resolves who a signed-in Supabase Auth user actually is, without
 * assuming — checks the sellers table first (a seller's own dashboard
 * takes priority over the generic customer view), and only falls back
 * to "customer" if no seller row matches. Never used for the admin,
 * who never has a Supabase Auth session at all. */
export async function resolveAccountKind(userId: string): Promise<"seller" | "customer"> {
  const admin = supabaseAdmin();
  const { data: seller } = await admin.from("sellers").select("id").eq("user_id", userId).maybeSingle();
  return seller ? "seller" : "customer";
}

export async function customerLogin(email: string, password: string) {
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw new Error("Incorrect email or password");
}

/** Creates a real Supabase Auth account, then a minimal `customers` row
 * on top of it. Deliberately thin — there's no functional difference
 * yet between having an account and browsing as a guest; this is
 * groundwork for later features (e.g. notifying registered customers
 * about new products), not a rebuild of the checkout/order system. */
export async function customerSignUp(email: string, password: string, phone: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (await isAdminEmail(normalizedEmail)) throw new Error("That email can't be used for a customer account");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");

  const sb = await supabaseServer();
  const { data: authData, error: authError } = await sb.auth.signUp({ email: normalizedEmail, password });
  if (authError) throw authError;
  if (!authData.user) throw new Error("Registration failed — please try again");

  const admin = supabaseAdmin();
  const { error: insertError } = await admin.from("customers").insert({
    user_id: authData.user.id,
    email: normalizedEmail,
    phone: phone.trim(),
  });
  if (insertError) {
    // Same "don't leave an orphaned login behind" rule as seller
    // registration — a failed profile insert rolls back the account.
    await admin.auth.admin.deleteUser(authData.user.id).catch(() => {});
    throw insertError;
  }
}

export async function customerLogout() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
}

export async function customerLogoutAction() {
  await customerLogout();
  redirect("/account");
}
