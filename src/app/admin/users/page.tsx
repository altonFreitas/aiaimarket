import { notFound } from "next/navigation";
import AdminUsers from "@/components/admin/AdminUsers";
import { adminUsers } from "@/lib/data/admin";
import { currentActor } from "@/lib/session";
import { getLang } from "@/lib/lang";

/** Staff accounts. Owner only -- not hidden from staff, refused to them,
 * because a hidden link is not a permission. */
export default async function AdminUsersPage() {
  const [lang, actor] = await Promise.all([getLang(), currentActor()]);
  if (actor?.kind !== "owner") notFound();
  const users = await adminUsers();
  return <AdminUsers lang={lang} users={users} />;
}
