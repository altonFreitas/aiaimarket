import ActivityLog from "@/components/admin/ActivityLog";
import { adminAuditLog } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

/** Who did what. Readable by any admin: a record only the owner can see is
 * a record staff have no reason to trust. */
export default async function ActivityPage() {
  await requireSection("settings");
  const [lang, rows] = await Promise.all([getLang(), adminAuditLog()]);
  return <ActivityLog lang={lang} rows={rows} />;
}
