"use server";
import { requireAdmin } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { disableTotp } from "@/lib/totp";
import { revalidatePath, updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";
import { normalizeFeatures } from "@/lib/sellerFeatures";
import { isMissingColumnError } from "@/lib/missingColumn";
import { audit, change } from "@/lib/audit";
import type { SellerStatus } from "@/lib/types";

async function setSellerStatus(id: string, status: SellerStatus) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("sellers").update({ status }).eq("id", id);
  if (error) throw error;
  // Approving/suspending a seller changes who appears in
  // getApprovedSellersById() and on /store/[slug], both of which are
  // cached catalog reads -- so the tag has to be busted, not just the
  // admin page path revalidated.
  updateTag(CACHE_TAGS.sellers);
  updateTag(CACHE_TAGS.products);
  revalidatePath("/admin/sellers");
  revalidatePath("/", "layout");
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

/** What this store may open, set by the owner on the Sellers screen.
 *
 * The list is filtered through normalizeFeatures() rather than trusted:
 * this is a server action, which means a public HTTP endpoint, and the
 * argument is whatever the request body said. Without that filter a
 * crafted request could write any string into the column -- including a
 * key from a future version of the app, which would then quietly become a
 * granted permission the day that version shipped.
 *
 * requireAdmin() already refuses a read-only staff account. It does NOT
 * restrict this to the owner: a staff admin holding the Sellers section is
 * exactly who runs the marketplace day to day, and this is the same kind
 * of decision as approving or suspending a store, which they already make.
 * (Granting ADMIN access is the owner's alone -- that one is a way to
 * escalate yourself, and this is not.) */
export async function setSellerFeatures(id: string, features: string[]) {
  const actor = await requireAdmin();
  const clean = normalizeFeatures(features);
  const sb = supabaseAdmin();

  const { data: was } = await sb
    .from("sellers").select("store_name, features").eq("id", id).maybeSingle();

  const { error } = await sb.from("sellers").update({ features: clean }).eq("id", id);
  if (error) {
    // The commonest failure by far, and the one with a useless message:
    // this shop has the code and has not run the SQL. Say which file.
    if (isMissingColumnError(error, "features")) {
      throw new Error(
        "This needs supabase/seller-features.sql to be run on the database first."
      );
    }
    throw error;
  }

  // Worth a record: it is the owner changing what somebody has paid for,
  // and "I never had that" / "I turned that off in June" is exactly the
  // disagreement an audit trail is for.
  await audit(actor, {
    action: "seller.features", entity: "seller", entityId: id,
    summary: `${was?.store_name ?? "seller"}: ${change(
      (normalizeFeatures(was?.features).join(", ") || "none"),
      (clean.join(", ") || "none")
    )}`,
    meta: { from: normalizeFeatures(was?.features), to: clean },
  });

  updateTag(CACHE_TAGS.sellers);
  revalidatePath("/admin/sellers");
  revalidatePath("/seller", "layout");
}
