import AdminHome from "@/components/admin/AdminHome";
import { adminAttention } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";

/** What needs doing today.
 *
 * The catalog used to live here, which meant opening the admin landed on a
 * list of everything sorted by nothing in particular -- the one view that
 * never tells you to act. It now lives at /admin/products. */
export default async function AdminHomePage() {
  const [lang, items] = await Promise.all([getLang(), adminAttention()]);
  return <AdminHome lang={lang} items={items} />;
}
