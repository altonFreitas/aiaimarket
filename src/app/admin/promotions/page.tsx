import PromotionsAdmin from "@/components/admin/PromotionsAdmin";
import { adminPromotions } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function AdminPromotionsPage() {
  await requireSection("storefront");
  const [lang, promotions] = await Promise.all([getLang(), adminPromotions()]);
  return <PromotionsAdmin lang={lang} promotions={promotions} />;
}
