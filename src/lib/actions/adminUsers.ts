"use server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "./guard";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/password";
import { passwordProblem } from "@/lib/passwordRules";

/* Staff accounts.
 *
 * Only the owner manages these. Letting staff create staff would make the
 * audit trail circular -- anyone recorded doing something could have made
 * the account that did it -- and there is no reason a shop this size needs
 * it. The check is here, not in the UI, because a hidden button is not a
 * permission. */

function ownerOnly(actorKind: string) {
  if (actorKind !== "owner") {
    throw new Error("Only the owner can manage admin accounts.");
  }
}

export async function createAdminUser(input: {
  name: string; email: string; password: string;
}) {
  const actor = await requireAdmin();
  ownerOnly(actor.kind);

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) throw new Error("A name is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("A valid email is required.");
  const bad = passwordProblem(input.password);
  if (bad) throw new Error(bad);

  const sb = supabaseAdmin();
  const { data, error } = await sb.from("admin_users").insert({
    name, email, password_hash: await hashPassword(input.password),
  }).select("id").single();

  // 23505 is the unique index on lower(email).
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new Error("There is already an account with that email.");
    }
    throw error;
  }

  await audit(actor, {
    action: "admin.userCreate", entity: "admin_user", entityId: data.id as string,
    summary: `created the account ${name} (${email})`,
    meta: { name, email },
  });
  revalidatePath("/admin/users");
  return data.id as string;
}

/** Deactivated, never deleted: the row is what every audit entry points at,
 * and a trail that forgets who acted when they leave is not a trail. */
export async function setAdminUserActive(id: string, active: boolean) {
  const actor = await requireAdmin();
  ownerOnly(actor.kind);

  const sb = supabaseAdmin();
  const { data: who } = await sb
    .from("admin_users").select("name, email").eq("id", id).maybeSingle();
  const { error } = await sb.from("admin_users").update({ active }).eq("id", id);
  if (error) throw error;

  await audit(actor, {
    action: active ? "admin.userEnable" : "admin.userDisable",
    entity: "admin_user", entityId: id,
    summary: `${active ? "re-enabled" : "disabled"} the account ${who?.name || id}`,
    meta: { name: who?.name ?? null, email: who?.email ?? null, active },
  });
  revalidatePath("/admin/users");
}

/** Sets a new password and clears the second factor with it.
 *
 * The two go together on purpose: the reason to reset a password is almost
 * always that somebody lost the phone the codes were on, and leaving the
 * old TOTP secret in place would hand them a new password they still
 * cannot use. They enrol again on next login. */
export async function resetAdminUserPassword(id: string, password: string) {
  const actor = await requireAdmin();
  ownerOnly(actor.kind);

  const bad = passwordProblem(password);
  if (bad) throw new Error(bad);

  const sb = supabaseAdmin();
  const { data: who } = await sb
    .from("admin_users").select("name").eq("id", id).maybeSingle();
  const { error } = await sb.from("admin_users").update({
    password_hash: await hashPassword(password),
    totp_secret: null, totp_enabled: false,
    totp_failed_attempts: 0, totp_locked_until: null,
  }).eq("id", id);
  if (error) throw error;

  await audit(actor, {
    action: "admin.userReset", entity: "admin_user", entityId: id,
    summary: `reset the password and second factor for ${who?.name || id}`,
    meta: { name: who?.name ?? null },
  });
  revalidatePath("/admin/users");
}
