/* Whether an invitation link still opens the door.
 *
 * Pure, and separate from the action that reads the row, because this is
 * the part with four answers and every one of them is a different sentence
 * on screen. "This link has already been used" and "this link has expired"
 * send a person to two different places -- back to the owner for a new one,
 * or to their own account because they already registered -- and a single
 * "invalid link" makes both of them ask the owner.
 */

export interface InviteRow {
  expires_at: string;
  used_at?: string | null;
  revoked_at?: string | null;
}

export type InviteState = "ok" | "used" | "revoked" | "expired" | "missing";

/** How long a new link lasts. Two weeks is long enough to be sent over
 * WhatsApp and acted on after a weekend, and short enough that a link
 * forgotten in a chat thread stops being a way in. */
export const INVITE_DAYS = 14;

/** Order matters. A link that was used AND has since expired is "used" --
 * that is what actually happened to it, and telling the holder it expired
 * would send them back to ask for another when they already have a store.
 * Revoked outranks expired for the same reason: the owner withdrew it, and
 * that is the answer the owner will be asked about. */
export function inviteState(row: InviteRow | null | undefined, now = new Date()): InviteState {
  if (!row) return "missing";
  if (row.used_at) return "used";
  if (row.revoked_at) return "revoked";
  if (new Date(row.expires_at).getTime() <= now.getTime()) return "expired";
  return "ok";
}

export function inviteExpiry(from = new Date(), days = INVITE_DAYS): string {
  return new Date(from.getTime() + days * 864e5).toISOString();
}

/** The i18n key explaining a state to the person holding the link. `ok`
 * has none: there is nothing to explain, they get the form. */
export const INVITE_MESSAGE: Record<Exclude<InviteState, "ok">, string> = {
  missing: "inviteMissing",
  used: "inviteUsed",
  revoked: "inviteRevoked",
  expired: "inviteExpired",
};
