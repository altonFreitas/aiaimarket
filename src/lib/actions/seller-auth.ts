"use server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { slugify } from "@/lib/utils";
import { notifyAdminNewSeller } from "@/lib/actions/notify";
import { inviteState } from "@/lib/sellerInvites";
import { guardLoginAttempt } from "@/lib/loginThrottle";
import { passwordProblem } from "@/lib/passwordRules";
import type { SellerType } from "@/lib/types";

export interface SellerRegistrationInput {
  fullName: string;
  storeName: string;
  email: string;
  phone: string;
  password: string;
  description: string;
  address: string;
  city: string;
  country: string;
  sellerType: SellerType;
  /** The token from the link. Registration is by invitation -- see
   * supabase/seller-invites.sql. */
  inviteToken: string;
}

/** Registers a new seller: creates a real Supabase Auth account (so the
 * seller has a genuine login, password reset, etc. — not a second
 * hand-rolled credential system), then a `sellers` row with status
 * "pending", and emails the admin so the application doesn't sit
 * unnoticed. The seller can log in right away (see /seller/dashboard),
 * but stays in a "pending" state — with no seller-only functionality
 * unlocked — until approved at /admin/sellers. */
export async function registerSeller(input: SellerRegistrationInput) {
  const email = input.email.trim().toLowerCase();
  const storeName = input.storeName.trim();
  if (!email || !input.password || !storeName) {
    throw new Error("Missing required fields");
  }
  const weak = passwordProblem(input.password);
  if (weak) throw new Error(weak);

  const sb = await supabaseServer();
  const admin = supabaseAdmin();

  // ---- the invitation -----------------------------------------------------
  // Checked here and not only on the page: the page decides what to draw,
  // this decides what exists. A form posted without ever loading that page
  // meets the same rule.
  //
  // settings.seller_registration_enabled is deliberately no longer
  // consulted. The invite is the gate now, and a shop that had once
  // switched that column off would otherwise find every link it sent
  // silently refused, with the owner holding a URL that looks fine.
  const token = (input.inviteToken || "").trim();
  const { data: invite } = await admin
    .from("seller_invites").select("id, expires_at, used_at, revoked_at")
    .eq("token", token).maybeSingle();
  if (inviteState(invite) !== "ok") {
    throw new Error("This invitation link is not valid. Ask the shop owner for a new one.");
  }

  // CLAIMED BEFORE THE ACCOUNT IS MADE, and released below if anything
  // after it fails. `.is("used_at", null)` makes this a compare-and-set in
  // Postgres rather than a check followed by a write, which is what stops
  // two people opening the same link at the same moment from both getting
  // a store. Claiming afterwards would close that window the wrong way
  // round: both registrations would already exist by the time either one
  // discovered the other.
  const { data: claimed } = await admin
    .from("seller_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", invite!.id).is("used_at", null)
    .select("id");
  if (!claimed?.length) {
    throw new Error("This invitation link has just been used. Ask the shop owner for a new one.");
  }
  const releaseInvite = async () => {
    await admin.from("seller_invites")
      .update({ used_at: null, used_by: null }).eq("id", invite!.id);
  };

  const { data: authData, error: authError } = await sb.auth.signUp({
    email,
    password: input.password,
  });
  // Every failure from here on gives the link back. A person whose
  // registration fell over on a duplicate email must not also be left
  // holding a burnt invitation.
  if (authError) { await releaseInvite(); throw authError; }
  if (!authData.user) {
    await releaseInvite();
    throw new Error("Registration failed — please try again");
  }

  // Slug collision handling — same pattern as product/category slugs
  // elsewhere in this app: try the plain slug, then -2, -3, ...
  const base = slugify(storeName) || "store";
  let slug = base;
  for (let n = 2; n <= 50; n++) {
    const { data: clash } = await admin.from("sellers").select("id").eq("slug", slug).maybeSingle();
    if (!clash) break;
    slug = `${base}-${n}`;
  }

  // Right after signUp(), the newly created auth user can occasionally
  // not yet be visible to a follow-up query that references it via
  // foreign key — a known brief eventual-consistency gap between
  // Supabase Auth and the database, not something that can be avoided
  // by ordering the calls differently. A few short retries, only for
  // that specific error (Postgres 23503, foreign key violation), closes
  // the gap instead of failing the whole registration.
  let insertError: { code?: string; message: string } | null = null;
  let sellerId: string | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
    const { data: made, error } = await admin.from("sellers").insert({
      user_id: authData.user.id,
      full_name: input.fullName.trim(),
      store_name: storeName,
      slug,
      email,
      phone: input.phone.trim(),
      description: input.description.trim(),
      address: input.address.trim(),
      city: input.city.trim(),
      country: input.country.trim(),
      seller_type: input.sellerType,
      status: "pending",
    }).select("id").single();
    insertError = error;
    sellerId = (made?.id as string) ?? null;
    if (!error || error.code !== "23503") break;
  }
  if (insertError || !sellerId) {
    // Roll back the auth account so a failed registration doesn't leave
    // an orphaned login with no seller profile behind it -- and the
    // invitation with it, so the person can try again on the same link.
    await admin.auth.admin.deleteUser(authData.user.id).catch(() => {});
    await releaseInvite();
    throw insertError || new Error("Registration failed — please try again");
  }

  // Which store the link let in. Best effort: the store exists and the
  // invitation is spent either way, and failing the registration over a
  // bookkeeping column would be the wrong trade.
  try {
    await admin.from("seller_invites").update({ used_by: sellerId }).eq("id", invite!.id);
  } catch { /* see above */ }

  await notifyAdminNewSeller({
    full_name: input.fullName.trim(),
    store_name: storeName,
    email,
    phone: input.phone.trim(),
  });
}

export async function loginSeller(email: string, password: string) {
  // A seller login is a login to somebody else's shop, their orders and
  // their payouts. Throttled before the guess reaches Supabase Auth.
  await guardLoginAttempt(email);
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw new Error("Incorrect email or password");
}

export async function logoutSeller() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
}

/** Form-action-compatible variant (bound directly to a <form action={...}>,
 * same pattern as the admin nav's logoutAction) — redirects server-side
 * itself rather than relying on the caller to navigate afterward. Goes
 * to the unified /account entry point, not a seller-only login page —
 * there isn't a separate one anymore. */
export async function logoutSellerAction() {
  await logoutSeller();
  redirect("/account");
}
