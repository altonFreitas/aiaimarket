"use server";
import { requireAdmin } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { PayoutMethod } from "@/lib/types";

const METHODS: readonly PayoutMethod[] = ["bank", "wallet", "cash", "other"];
const MAX_REFERENCE_LEN = 120;
const MAX_NOTE_LEN = 500;
/** A single payout larger than this is almost certainly a typo — a decimal
 * point in the wrong place turns $85 into $8,500. The ceiling is a
 * data-entry guard, not a policy about how much a seller may earn; raise it
 * here if the marketplace ever genuinely settles amounts this size. */
const MAX_PAYOUT = 100_000;

export interface RecordPayoutInput {
  sellerId: string;
  amount: number;
  method: PayoutMethod;
  reference?: string;
  note?: string;
  /** ISO date/timestamp. Defaults to now — set it when recording a transfer
   * that was actually made on an earlier day. */
  paidAt?: string;
}

/** Record money actually handed over to a seller.
 *
 * This is the marketplace's only writable money fact. Everything else about
 * a seller's balance — gross sales, commission, what is still owed — is
 * derived from completed orders minus these rows (see adminSellerLedgers),
 * so there is no second stored number that can disagree with this one.
 *
 * The seller is looked up rather than trusted: an id that doesn't belong to
 * a real seller is rejected here instead of becoming an orphaned ledger row
 * that quietly never appears on anyone's balance. */
export async function recordPayout(input: RecordPayoutInput) {
  await requireAdmin();

  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero");
  if (amount > MAX_PAYOUT) throw new Error("That amount looks wrong — check it and try again");
  if (!METHODS.includes(input.method)) throw new Error("Unknown payout method");

  const sb = supabaseAdmin();
  const { data: seller } = await sb.from("sellers").select("id").eq("id", input.sellerId).maybeSingle();
  if (!seller) throw new Error("Seller not found");

  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) throw new Error("Invalid payout date");

  const { error } = await sb.from("seller_payouts").insert({
    seller_id: seller.id,
    amount,
    method: input.method,
    reference: (input.reference || "").trim().slice(0, MAX_REFERENCE_LEN),
    note: (input.note || "").trim().slice(0, MAX_NOTE_LEN),
    paid_at: paidAt.toISOString(),
  });
  // The most likely cause by far is that supabase/marketplace-v2.sql hasn't
  // been run on this database. Saying so beats "relation does not exist".
  if (error) throw new Error(`Could not record the payout: ${error.message}`);

  revalidatePath("/admin/payouts");
  revalidatePath("/seller/dashboard");
}

/** Reverse a payout recorded by mistake. A hard delete rather than a
 * reversing entry: this ledger exists so a person can see what was paid,
 * and a wrong row that was never a real transfer is noise in that record,
 * not history worth keeping. Real refunds from a seller back to the platform
 * are a different event and don't belong here at all. */
export async function deletePayout(id: string) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("seller_payouts").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/payouts");
  revalidatePath("/seller/dashboard");
}
