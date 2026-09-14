"use server";
import { requireAdmin } from "./guard";
import { normalizeRestockPct } from "@/lib/restock";
import { normalizeCurrencyCode, normalizeTaxRate } from "@/lib/money";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath, updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";
import type { Bank, Wallet, Zone } from "@/lib/types";
import { normalizeZones } from "@/lib/zones";

/** A period a shop commits to, in days or years.
 *
 * Empty is a real answer and is NOT zero: it means "we have not decided",
 * which is what keeps the policy page showing its unfinished notice. Storing
 * 0 instead would publish "you may return within 0 days". */
function period(v: unknown, max: number): number | null {
  if (v == null || String(v).trim() === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= max ? n : null;
}

export async function saveSettings(input: {
  store_name: string; wa_number: string; hours: string;
  municipality: string; post: string; suku: string; landmark: string;
  pickup: boolean; commission_rate: number; seller_registration_enabled: boolean;
  restock_alert_pct?: number;
  /* The five facts the policy pages cannot know, and the money settings.
     All optional: a database that has not run
     supabase/legal-currency-tax.sql has none of these columns, and a save
     naming a column that does not exist fails the whole save. */
  legal_address?: string; legal_registration?: string;
  legal_retention_years?: number | null;
  legal_return_days?: number | null;
  legal_refund_days?: number | null;
  display_currency?: string;
  tax_rate?: number; tax_label?: string; tax_included?: boolean;
}) {
  await requireAdmin();
  const sb = supabaseAdmin();
  // Clamped here as well as by the column's check constraint. The
  // constraint is the one that cannot be bypassed; this one turns a typo
  // into a sensible number instead of into a failed save.
  const patch = {
    ...input,
    restock_alert_pct: normalizeRestockPct(input.restock_alert_pct),
    legal_retention_years: period(input.legal_retention_years, 99),
    legal_return_days: period(input.legal_return_days, 365),
    legal_refund_days: period(input.legal_refund_days, 365),
    display_currency: normalizeCurrencyCode(input.display_currency),
    // A percentage typed by a person, stored as the fraction the arithmetic
    // wants. 2.5 in the box is 0.025 in the column.
    tax_rate: normalizeTaxRate(input.tax_rate),
  };
  const { error } = await sb.from("settings").update(patch).eq("id", 1);
  if (error) throw error;
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.settings);
}

export async function saveBanks(banks: Bank[]) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("settings").update({ banks }).eq("id", 1);
  if (error) throw error;
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.settings);
}

export async function saveWallets(wallets: Wallet[]) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("settings").update({ wallets }).eq("id", 1);
  if (error) throw error;
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.settings);
}

export async function saveZones(zones: Zone[]) {
  await requireAdmin();
  const sb = supabaseAdmin();
  /* NORMALISED ON THE WAY IN, which is what actually cleans the database.
   *
   * supabase/seed.sql wrote zones with the ids z1, z2 and z3, and the old
   * editor patched the stored array rather than replacing it -- so the junk
   * survived every save and the checkout kept offering "zone_z1" as if it
   * were a place. Writing the canonical three is what removes it, and it
   * happens the first time anybody touches this screen. */
  const { error } = await sb
    .from("settings").update({ zones: normalizeZones(zones) }).eq("id", 1);
  if (error) throw error;
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.settings);
}
