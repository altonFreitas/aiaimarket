import { redirect } from "next/navigation";
import AdminUsers from "@/components/admin/AdminUsers";
import { adminUsers } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

/** Staff accounts. Owner only -- not hidden from staff, refused to them,
 * because a hidden link is not a permission.
 *
 * It used to refuse with notFound(), which rendered the site's bare 404 --
 * shop header, no admin navigation, "This page could not be found." Told
 * to somebody who is signed in and looking at the admin, that reads as a
 * broken website rather than as a door that is not theirs. And because
 * the page had already begun streaming, the response still carried a 200,
 * so the server log said the page was fine while the screen said 404 --
 * which is a genuinely confusing pair of facts to be handed.
 *
 * It is the same refusal every other section gives now. */
export default async function AdminUsersPage() {
  const actor = await requireSection("settings");
  if (actor.kind !== "owner") redirect("/admin/no-access");

  const [lang, users] = await Promise.all([getLang(), adminUsers()]);
  return <AdminUsers lang={lang} users={users} ownerEmail={ownerEmailForDisplay()} />;
}

/** Read here rather than in the component: the component runs in the
 * browser, where process.env does not exist. */
function ownerEmailForDisplay(): string {
  return (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
}
