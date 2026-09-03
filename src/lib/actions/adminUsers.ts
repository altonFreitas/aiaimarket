"use server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "./guard";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/password";
import { passwordProblem } from "@/lib/passwordRules";
import {
  GRANTABLE_SECTIONS, normalizeRole, normalizeSections,
  type AdminRole, type SectionKey,
} from "@/lib/adminSections";

/* Staff accounts.
 *
 * Only the owner manages these. Letting staff create staff would make the
 * audit trail circular -- anyone recorded doing something could have made
 * the account that did it -- and there is no reason a shop this size needs
 * it. The check is here, not in the UI, because a hidden button is not a
 * permission. */

/** The owner's own address, from the environment. */
function ownerEmail(): string {
  return (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
}

/** One address, one identity.
 *
 * A staff account created under the owner's own email used to shadow
 * them: the owner would sign in, the owner password would not match
 * whatever they typed, and the staff row would answer instead -- so the
 * owner became that account, with that account's access. If it was
 * read-only, it looked exactly like the owner had lost their own shop.
 *
 * The login refuses to resolve the owner's address to a staff row now
 * (lib/session.ts), so an account like that can no longer take anybody
 * over. This stops one being made in the first place, because an account
 * that can never be signed into is not a useful thing to own either. */
function notTheOwnersEmail(email: string) {
  const owner = ownerEmail();
  if (owner && email === owner) {
    throw new Error(
      "That is your own sign-in address. Give the staff account its own email."
    );
  }
}

function ownerOnly(actorKind: string) {
  if (actorKind !== "owner") {
    throw new Error("Only the owner can manage admin accounts.");
  }
}

/** Section keys we recognise AND are willing to grant.
 *
 * Home is filtered out rather than rejected: it is available to every
 * signed-in account and is not a checkbox, so storing it would put a
 * permission in the row that nothing reads -- and make the screen and the
 * database disagree about what was granted. */
function grantable(value: unknown): SectionKey[] {
  return normalizeSections(value).filter((s) => GRANTABLE_SECTIONS.includes(s));
}

/** A line for the audit trail that a person can read a year from now
 * without knowing what a section key is. */
function describe(role: AdminRole, sections: SectionKey[]): string {
  const what = role === "admin" ? "full access" : "read-only";
  if (!sections.length) return `${what}, no areas`;
  return `${what} in ${sections.join(", ")}`;
}

export async function createAdminUser(input: {
  name: string; email: string; password: string;
  role?: AdminRole; sections?: string[];
}) {
  const actor = await requireAdmin();
  ownerOnly(actor.kind);

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) throw new Error("A name is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("A valid email is required.");
  notTheOwnersEmail(email);
  const bad = passwordProblem(input.password);
  if (bad) throw new Error(bad);

  // Normalised, not trusted. These arrive from a form; anything the
  // application does not recognise is dropped rather than stored, so a
  // section key that does not exist can never sit in a row looking like a
  // granted permission.
  const role = normalizeRole(input.role);
  const sections = grantable(input.sections);

  const sb = supabaseAdmin();
  const { data, error } = await sb.from("admin_users").insert({
    name, email, password_hash: await hashPassword(input.password),
    role, sections,
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
    summary: `created the account ${name} (${email}) as ${describe(role, sections)}`,
    meta: { name, email, role, sections },
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

/** Changes what an existing account may do and where it may go.
 *
 * Takes effect immediately, not at their next sign-in: role and sections
 * are read from this row on every request rather than carried in the
 * session cookie. Somebody being demoted mid-shift loses the buttons on
 * their next click.
 *
 * Owner only, like everything else on this screen. If a staff admin could
 * reach this, they could grant themselves the sections they were not given
 * -- and then the whole arrangement would be decoration. */
export async function setAdminUserAccess(
  id: string, role: AdminRole, sections: string[]
) {
  const actor = await requireAdmin();
  ownerOnly(actor.kind);

  const nextRole = normalizeRole(role);
  const nextSections = grantable(sections);

  const sb = supabaseAdmin();
  const { data: who } = await sb
    .from("admin_users").select("name, role, sections").eq("id", id).maybeSingle();
  if (!who) throw new Error("That account no longer exists.");

  const { error } = await sb
    .from("admin_users").update({ role: nextRole, sections: nextSections }).eq("id", id);
  if (error) throw error;

  await audit(actor, {
    action: "admin.userAccess", entity: "admin_user", entityId: id,
    summary: `set ${who.name || id} to ${describe(nextRole, nextSections)}`,
    meta: {
      name: who.name ?? null,
      from: { role: normalizeRole(who.role), sections: normalizeSections(who.sections) },
      to: { role: nextRole, sections: nextSections },
    },
  });
  revalidatePath("/admin/users");
}
