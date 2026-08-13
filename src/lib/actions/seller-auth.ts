"use server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { slugify } from "@/lib/utils";
import { notifyAdminNewSeller } from "@/lib/actions/notify";
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
  if (input.password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const sb = await supabaseServer();
  const { data: authData, error: authError } = await sb.auth.signUp({
    email,
    password: input.password,
  });
  if (authError) throw authError;
  if (!authData.user) throw new Error("Registration failed — please try again");

  const admin = supabaseAdmin();

  // Slug collision handling — same pattern as product/category slugs
  // elsewhere in this app: try the plain slug, then -2, -3, ...
  const base = slugify(storeName) || "store";
  let slug = base;
  for (let n = 2; n <= 50; n++) {
    const { data: clash } = await admin.from("sellers").select("id").eq("slug", slug).maybeSingle();
    if (!clash) break;
    slug = `${base}-${n}`;
  }

  const { error: insertError } = await admin.from("sellers").insert({
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
  });
  if (insertError) {
    // Roll back the auth account so a failed registration doesn't leave
    // an orphaned login with no seller profile behind it.
    await admin.auth.admin.deleteUser(authData.user.id).catch(() => {});
    throw insertError;
  }

  await notifyAdminNewSeller({
    full_name: input.fullName.trim(),
    store_name: storeName,
    email,
    phone: input.phone.trim(),
  });
}

export async function loginSeller(email: string, password: string) {
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
 * itself rather than relying on the caller to navigate afterward. */
export async function logoutSellerAction() {
  await logoutSeller();
  redirect("/seller/login");
}
