"use server";
import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/actions/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { inviteExpiry } from "@/lib/sellerInvites";

/* Minting and withdrawing the links that let somebody register a store.
 *
 * THE TOKEN IS A CREDENTIAL. 24 random bytes from the OS, base64url so it
 * survives being pasted into WhatsApp, a URL and back out again. Not a
 * uuid: a uuid is an identifier that happens to be hard to guess, and
 * every habit around them -- logging them, putting them in error messages,
 * letting them appear in a support screenshot -- is wrong for a secret.
 */
const TOKEN_BYTES = 24;

function mintToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

/** The link to send. Absolute, because it is going into a chat message:
 * a relative path is not tappable there, which is the same reason the
 * order notifications refuse to send without this variable set. */
function inviteUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  return `${base}/seller/register?invite=${token}`;
}

export async function createSellerInvite(note: string) {
  const actor = await requireAdmin();
  const sb = supabaseAdmin();
  const token = mintToken();

  const { data, error } = await sb.from("seller_invites").insert({
    token,
    note: note.trim().slice(0, 200),
    created_by: actor.label,
    expires_at: inviteExpiry(),
  }).select("id, token, expires_at").single();
  if (error) throw error;

  await audit(actor, {
    action: "seller.invite",
    entity: "seller_invite",
    entityId: data.id,
    // The note, never the token. An audit row is read on screens and in
    // support conversations; a live credential must not be sitting in one.
    summary: `${actor.label} made a seller invitation${note.trim() ? ` for ${note.trim()}` : ""}`,
  });

  revalidatePath("/admin/sellers");
  return { id: data.id as string, url: inviteUrl(data.token as string), expiresAt: data.expires_at as string };
}

/** Withdraws an unused link. An already-used one is left alone: its row is
 * the record of how that store got in, and "revoking" it would rewrite
 * that without closing anything. */
export async function revokeSellerInvite(id: string) {
  const actor = await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("seller_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id).is("used_at", null).is("revoked_at", null);
  if (error) throw error;

  await audit(actor, {
    action: "seller.invite_revoked", entity: "seller_invite", entityId: id,
    summary: `${actor.label} withdrew a seller invitation`,
  });
  revalidatePath("/admin/sellers");
}
