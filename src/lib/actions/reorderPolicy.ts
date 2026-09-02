"use server";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "./guard";

/* The four numbers behind the reorder plan.
 *
 * Bounded here as well as in the database, and to the same limits: the
 * column checks are the lock that cannot be bypassed, these are the ones
 * that produce a sentence a shopkeeper can act on instead of a Postgres
 * constraint name. */
export interface ReorderPolicyInput {
  windowDays: number;
  reviewDays: number;
  safetyDays: number;
  defaultLeadDays: number;
}

const BOUNDS: Record<keyof ReorderPolicyInput, [number, number, string]> = {
  windowDays: [7, 365, "Demand window must be between 7 and 365 days."],
  reviewDays: [1, 180, "Ordering cycle must be between 1 and 180 days."],
  safetyDays: [0, 180, "Safety buffer must be between 0 and 180 days."],
  defaultLeadDays: [1, 365, "Assumed delivery time must be between 1 and 365 days."],
};

export async function saveReorderPolicy(input: ReorderPolicyInput) {
  await requireAdmin();

  const clean: Record<string, number> = {};
  for (const key of Object.keys(BOUNDS) as Array<keyof ReorderPolicyInput>) {
    const [min, max, message] = BOUNDS[key];
    const n = Math.round(Number(input[key]));
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(message);
    clean[key] = n;
  }

  const sb = supabaseAdmin();
  const { error } = await sb.from("settings").update({
    reorder_window_days: clean.windowDays,
    reorder_review_days: clean.reviewDays,
    reorder_safety_days: clean.safetyDays,
    reorder_default_lead_days: clean.defaultLeadDays,
  }).eq("id", 1);
  if (error) throw error;

  revalidatePath("/admin/procurement/reorder");
  revalidatePath("/admin");
}
