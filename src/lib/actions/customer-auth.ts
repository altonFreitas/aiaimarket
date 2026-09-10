"use server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit, callerKey } from "@/lib/rateLimit";
import { guardLoginAttempt } from "@/lib/loginThrottle";
import { passwordProblem } from "@/lib/passwordRules";

/** True only for the one hardcoded owner account (see lib/session.ts) --
 * checked BEFORE anything touches Supabase Auth, since the admin never
 * has (and shouldn't need) an auth.users row. This is what lets the one
 * unified /account entry point route an admin login to the existing,
 * already-secure TOTP flow instead of treating them like anyone else.
 * Async because every export from a "use server" file must be — this
 * is called directly from the client form. */
export async function isAdminEmail(email: string): Promise<boolean> {
  const typed = email.trim().toLowerCase();
  if (!typed) return false;

  const configured = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  // Unconfigured must never match — otherwise "" === "" routes an empty
  // login straight into the admin TOTP flow.
  if (configured && typed === configured) return true;

  // Staff accounts route the same way. Without this a staff member typing
  // their email here fell through to the customer login, which has never
  // heard of them, failed, and left them staring at the same form -- while
  // the owner, whose email IS checked, sailed through.
  //
  // Only ACTIVE accounts. A disabled one cannot sign in to the admin
  // anyway, so sending it there would be a dead end, and this way
  // disabling somebody also stops their email answering this question.
  // THROTTLED, because this is an unauthenticated boolean about who exists.
  // A form that answers "is this an admin" instantly, forever, for anyone,
  // is a directory of staff accounts read one guess at a time.
  const limit = await rateLimit(await callerKey("account-probe"), 20, 300);
  if (!limit.allowed) return false;

  try {
    const admin = supabaseAdmin();
    // .eq, NOT .ilike. In Postgres, % and _ are LIKE wildcards, so an
    // ILIKE against raw user input is a search, not a lookup: submitting
    // "%" matched every staff account, and "a%", "b%", … read back the
    // real addresses a character at a time. Emails are stored lower-cased
    // by lib/actions/adminUsers.ts (and the unique index on lower(email)
    // enforces it), so an exact match on the lower-cased input is the same
    // question asked safely.
    //
    // This codebase already knew: lib/actions/orders.ts carries a comment
    // choosing .eq() over .ilike() for exactly this reason. The lesson had
    // not been carried across.
    const { data, error } = await admin
      .from("admin_users").select("id").eq("email", typed).eq("active", true).maybeSingle();
    return !error && !!data;
  } catch {
    // No admin_users table yet: only the owner exists, and they were
    // already checked above.
    return false;
  }
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
  // Before the password is checked, not after -- see guardLoginAttempt.
  await guardLoginAttempt(email);
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
  // The same floor as a staff or seller login. A customer account holds an
  // address and an order history; there is no version of this app where
  // eight characters is enough for one login and twelve for another.
  const weak = passwordProblem(password);
  if (weak) throw new Error(weak);

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
