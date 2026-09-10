"use server";
import { revalidatePath } from "next/cache";
import { requireAdminRead } from "@/lib/actions/guard";
import { resolveLogin, type AdminActor } from "@/lib/session";
import {
  getOrCreateTotpSetup, confirmTotpSetup, disableTotp, getTotpStatus, type TotpTarget,
} from "@/lib/totp";
import { audit } from "@/lib/audit";

/* Turning the admin's own second factor on and off.
 *
 * WHY THIS DID NOT EXIST. 2FA was enrolled at the first login and there
 * was no way back: lib/totp.ts has had disableTotp() all along, and only
 * the seller's settings screen called it. For the owner it was a one-way
 * door -- which is a defensible answer for a live shop and a bad one for a
 * shop being built, and an impossible one the day the phone holding the
 * secret is replaced. There was no re-enrolment path either, because
 * re-enrolling means clearing the old secret first.
 *
 * Same target rule as the login (lib/actions/auth.ts): the owner's secret
 * lives on the settings row, each staff account's on its own row, so one
 * person turning theirs off never touches anybody else's.
 *
 * requireAdminRead, NOT requireAdmin. Everything here acts on the caller's
 * OWN login and nothing else -- the same reason the Excel export uses it.
 * Gating on the write role would leave a read-only staff account unable to
 * turn 2FA ON for itself, which is the opposite of the point: a reader is
 * still a person with a password, and their account is still a way into
 * the shop.
 */
function targetFor(actor: AdminActor): TotpTarget {
  return actor.kind === "owner"
    ? { table: "settings", idValue: 1 }
    : { table: "admin_users", idValue: actor.id as string };
}

export async function adminTotpStatusAction(): Promise<boolean> {
  const actor = await requireAdminRead();
  return getTotpStatus(targetFor(actor));
}

/** The QR and the secret behind it. Null when 2FA is already on -- the
 * secret is never re-shown for an enrolled account, which is what makes
 * "turn it off, then on again" the only way to move it to a new phone. */
export async function startAdminTotpSetupAction() {
  const actor = await requireAdminRead();
  return getOrCreateTotpSetup(targetFor(actor), actor.label);
}

export async function confirmAdminTotpSetupAction(code: string): Promise<boolean> {
  const actor = await requireAdminRead();
  const ok = await confirmTotpSetup(targetFor(actor), code, actor.label);
  if (ok) {
    await audit(actor, {
      action: "auth.totp_enabled",
      summary: `${actor.label} turned two-factor authentication on`,
    });
    revalidatePath("/admin/settings");
  }
  return ok;
}

/** Off, and the secret wiped with it.
 *
 * THE PASSWORD, NOT A CODE. Requiring a current code would prove
 * possession of the phone -- which is exactly what somebody replacing a
 * lost phone cannot do, and locking the owner out of their own shop is a
 * worse outcome than the one being defended against. The password is a
 * real bar (an unattended open session is not enough) and it is the one
 * factor that survives losing the device.
 *
 * It is checked against THIS actor, not merely "some valid login": for the
 * owner that is ADMIN_EMAIL/ADMIN_PASSWORD, for staff their own row. A
 * staff member's password must not be able to switch off the owner's.
 */
export async function disableAdminTotpAction(
  identifier: string, password: string
): Promise<{ ok: boolean; reason?: "credentials" }> {
  const actor = await requireAdminRead();
  const who = await resolveLogin(identifier, password).catch(() => null);
  if (!who || who.kind !== actor.kind || (who.id ?? null) !== (actor.id ?? null)) {
    return { ok: false, reason: "credentials" };
  }
  await disableTotp(targetFor(actor));
  await audit(actor, {
    action: "auth.totp_disabled",
    summary: `${actor.label} turned two-factor authentication off`,
  });
  revalidatePath("/admin/settings");
  return { ok: true };
}
