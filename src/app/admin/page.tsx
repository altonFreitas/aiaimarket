import AdminHome from "@/components/admin/AdminHome";
import { adminAttention } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";
import { canSee, sectionForPath } from "@/lib/adminSections";

/** What needs doing today.
 *
 * The catalog used to live here, which meant opening the admin landed on a
 * list of everything sorted by nothing in particular -- the one view that
 * never tells you to act. It now lives at /admin/products. */
export default async function AdminHomePage() {
  const actor = await requireSection("home");
  const [lang, items] = await Promise.all([getLang(), adminAttention()]);

  // Home is the one screen everybody holds, which would make it a way to
  // read every other section through the back door -- "8 products below
  // their reorder point" is a fact about the catalog, told to somebody who
  // was not given the catalog. Each card links somewhere; the card is shown
  // only if its destination is.
  const mine = items.filter((item) => {
    const section = sectionForPath(item.href);
    return section !== null && canSee(actor, section);
  });

  return <AdminHome lang={lang} items={mine} />;
}
