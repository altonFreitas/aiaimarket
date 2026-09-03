import PayoutsAdmin from "@/components/admin/PayoutsAdmin";
import { adminSellerLedgers, adminPayouts } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

/** What the marketplace owes each seller, and what it has already paid.
 *
 * Both halves come from one pass over orders and one over payouts (see
 * adminSellerLedgers) rather than a per-seller query, so this page costs the
 * same whether the marketplace has three sellers or three hundred. */
export default async function AdminPayoutsPage() {
  await requireSection("sellers");
  const [lang, ledgers, payouts] = await Promise.all([
    getLang(), adminSellerLedgers(), adminPayouts(),
  ]);
  // Only approved sellers can trade, so only they can be owed anything --
  // a pending application with a $0 balance is noise on this screen.
  const active = ledgers.filter((l) => l.seller.status === "approved");
  return <PayoutsAdmin lang={lang} ledgers={active} payouts={payouts} />;
}
