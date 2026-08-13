"use server";
import { requireAdmin } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { SellerStatus } from "@/lib/types";

async function setSellerStatus(id: string, status: SellerStatus) {
  await requireAdmin();
  const sb = supabaseAdmin();
  const { error } = await sb.from("sellers").update({ status }).eq("id", id);
  if (error) throw error;
  revalidatePath("/admin/sellers");
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
