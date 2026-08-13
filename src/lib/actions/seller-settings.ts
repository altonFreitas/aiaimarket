"use server";
import { requireSeller } from "./guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export interface SellerProfileInput {
  storeName: string;
  description: string;
  phone: string;
  address: string;
  city: string;
  country: string;
}

/** A seller may edit their own profile regardless of approval status
 * (fixing a typo in a still-pending application is reasonable) — this
 * is deliberately requireSeller(), not requireApprovedSeller(). It's
 * only actual marketplace-facing capability (creating products) that's
 * gated on being approved. */
export async function updateSellerProfile(input: SellerProfileInput) {
  const seller = await requireSeller();
  const storeName = input.storeName.trim();
  if (!storeName) throw new Error("Store name is required");

  const sb = supabaseAdmin();
  const { error } = await sb.from("sellers").update({
    store_name: storeName,
    description: input.description.trim(),
    phone: input.phone.trim(),
    address: input.address.trim(),
    city: input.city.trim(),
    country: input.country.trim(),
  }).eq("id", seller.id);
  if (error) throw error;

  revalidatePath("/seller/settings");
  revalidatePath("/seller/dashboard");
}
