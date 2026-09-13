"use server";
import { requireAdmin } from "./guard";
import { normalizeRestockPct } from "@/lib/restock";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath, updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";
import type { Bank, Wallet, Zone } from "@/lib/types";
import { normalizeZones } from "@/lib/zones";

export async function saveSettings(input: {
  store_name: string; wa_number: string; hours: string;
  municipality: string; post: string; suku: string; landmark: string;
  pickup: boolean; commission_rate: number; seller_registration_enabled: boolean;
  restock_alert_pct?: number;
}) {
  await requireAdmin();
  const sb = supabaseAdmin();
  // Clamped here as well as by the column's check constraint. The
  // constraint is the one that cannot be bypassed; this one turns a typo
  // into a sensible number instead of into a failed save.
  const patch = {
    ...input,
    restock_alert_pct: normalizeRestockPct(input.restock_alert_pct),
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
