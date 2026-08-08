"use server";
import { requireAdmin } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { Bank, Wallet, Zone } from "@/lib/types";

export async function saveSettings(input: {
  store_name: string; wa_number: string; hours: string;
  municipality: string; post: string; suku: string; landmark: string;
  pickup: boolean;
}) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("settings").update(input).eq("id", 1);
  if (error) throw error;
  revalidatePath("/", "layout");
}

export async function saveBanks(banks: Bank[]) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("settings").update({ banks }).eq("id", 1);
  if (error) throw error;
  revalidatePath("/", "layout");
}

export async function saveWallets(wallets: Wallet[]) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("settings").update({ wallets }).eq("id", 1);
  if (error) throw error;
  revalidatePath("/", "layout");
}

export async function saveZones(zones: Zone[]) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("settings").update({ zones }).eq("id", 1);
  if (error) throw error;
  revalidatePath("/", "layout");
}
