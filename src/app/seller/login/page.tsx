import { redirect } from "next/navigation";

/** /account is the one unified login for everyone now — this old
 * seller-only page just forwards there, so any bookmark or old link
 * still works instead of 404ing. */
export default function SellerLoginPage() {
  redirect("/account");
}
