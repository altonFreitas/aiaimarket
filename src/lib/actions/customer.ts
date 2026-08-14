"use server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

/** A customer may only ever update their own row — resolved from the
 * verified session, never a client-supplied id, same discipline as
 * every other account-scoped action in this app. */
export async function updateCustomerNotifyPreference(notify: boolean) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const admin = supabaseAdmin();
  const { error } = await admin.from("customers").update({ notify_new_products: notify }).eq("user_id", user.id);
  if (error) throw error;
  revalidatePath("/account");
}
