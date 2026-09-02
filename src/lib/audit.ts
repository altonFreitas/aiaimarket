import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AdminActor } from "@/lib/session";

/* The record of who did what.
 *
 * Append-only: nothing here is ever updated or deleted, and the actor's
 * name is COPIED onto every entry rather than joined. An audit trail that
 * forgets who did something once their account is removed is not an audit
 * trail, and the owner has no account row to join to at all.
 *
 * Writes never throw. A shop cannot be stopped from refunding a customer
 * because the logging table is unreachable -- the action is the thing that
 * matters and the record is the thing that helps later. The failure is
 * reported so it is not silent, and a gap in the trail is visible as a gap.
 */

export interface AuditEntry {
  /** Dotted and groupable: "stock.adjust", "order.refund", "po.receive". */
  action: string;
  /** What it happened to, and which one. */
  entity?: string;
  entityId?: string | null;
  /** One line a person can read without opening anything else. */
  summary?: string;
  /** Anything structured worth keeping -- before and after, amounts. */
  meta?: Record<string, unknown>;
}

export async function audit(actor: AdminActor, entry: AuditEntry): Promise<void> {
  try {
    const sb = supabaseAdmin();
    const { error } = await sb.from("audit_log").insert({
      actor_kind: actor.kind,
      actor_id: actor.id,
      actor_label: actor.label,
      action: entry.action,
      entity: entry.entity || "",
      entity_id: entry.entityId ?? null,
      summary: entry.summary || "",
      meta: entry.meta || {},
    });
    // A missing table means supabase/admin-users.sql has not been run.
    // That is a state to grow out of, not to crash on.
    if (error && error.code !== "42P01") {
      console.error("[audit] could not record %s: %s", entry.action, error.message);
    }
  } catch (e) {
    console.error("[audit] could not record %s: %s", entry.action,
      e instanceof Error ? e.message : String(e));
  }
}

/** "12 -> 0", for a summary line. Keeps the before-and-after phrasing
 * identical everywhere instead of each action inventing its own. */
export function change(from: unknown, to: unknown): string {
  return `${String(from)} → ${String(to)}`;
}
