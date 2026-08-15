"use server";
import { requireAdmin } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { disableTotp } from "@/lib/totp";
import { revalidatePath } from "next/cache";
import type { SellerStatus } from "@/lib/types";

async function setSellerStatus(id: string, status: SellerStatus) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("sellers").update({ status }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/sellers");
}

export async function approveSeller(id: string) {
  await setSellerStatus(id, "approved");
}
export async function rejectSeller(id: string) {
  await setSellerStatus(id, "rejected");
}
export async function suspendSeller(id: string) {
  await setSellerStatus(id, "suspended");
}
export async function reactivateSeller(id: string) {
  await setSellerStatus(id, "approved");
}

/** Lost-phone recovery for a seller's 2FA. The seller can't turn their
 * own 2FA off once locked out (that requires already passing 2FA — the
 * exact thing they can't do), so this is the way back in: the admin
 * verifies who they're talking to some other way (a WhatsApp call,
 * knowing their store/order history, etc.) and clears it for them here.
 * Reuses disableTotp() from lib/totp.ts — the same function the seller's
 * own settings page uses to opt out voluntarily, not a separate
 * mechanism. The seller can log in with just their password again right
 * away, and re-enroll a new phone from /seller/settings if they want
 * 2FA back on. */
export async function resetSellerTotpAction(id: string) {
  await requireAdmin();
  await disableTotp({ table: "sellers", idValue: id });
  revalidatePath("/admin/sellers");
}
