import "server-only";
import { isLoggedIn } from "@/lib/session";

/** Every admin server action must call this before touching the
 * service-role client. Throws, which surfaces as a generic error to any
 * caller that isn't an authenticated admin request. */
export async function requireAdmin() {
  const ok = await isLoggedIn();
  if (!ok) throw new Error("Not authenticated");
}
