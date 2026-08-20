import PromotionsAdmin from "@/components/admin/PromotionsAdmin";
import { adminPromotions } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";

export default async function AdminPromotionsPage() {
  const [lang, promotions] = await Promise.all([getLang(), adminPromotions()]);
  return <PromotionsAdmin lang={lang} promotions={promotions} />;
}
