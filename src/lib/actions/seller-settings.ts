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
  deliveryAvailable: boolean;
  pickupAvailable: boolean;
  deliveryFee: number | null;
  deliveryArea: string;
}

/** A seller may edit their own profile regardless of approval status
 * (fixing a typo in a still-pending application is reasonable) — this
 * is deliberately requireSeller(), not requireApprovedSeller(). It's
 * only actual marketplace-facing capability (creating products) that's
 * gated on being approved.
 *
 * The shipping fields here are stored but not yet read anywhere at
 * checkout (which still prices delivery using the platform's own
 * zones) — see the schema.sql comment on sellers.delivery_available.
 * This just lets a seller record their shipping setup in advance. */
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
    delivery_available: input.deliveryAvailable,
    pickup_available: input.pickupAvailable,
    delivery_fee: input.deliveryFee,
    delivery_area: input.deliveryArea.trim(),
  }).eq("id", seller.id);
  if (error) throw error;

  revalidatePath("/seller/settings");
  revalidatePath("/seller/dashboard");
}
