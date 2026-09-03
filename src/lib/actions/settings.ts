"use server";
import { requireAdmin } from "./guard";
import { normalizeRestockPct } from "@/lib/restock";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath, updateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache";
import type { Bank, Wallet, Zone } from "@/lib/types";

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
  const { error } = await sb.from("settings").update({ zones }).eq("id", 1);
  if (error) throw error;
  revalidatePath("/", "layout");
  updateTag(CACHE_TAGS.settings);
}
