import SellersAdmin from "@/components/admin/SellersAdmin";
import { adminSellers } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";

export default async function AdminSellersPage() {
  const [lang, sellers] = await Promise.all([getLang(), adminSellers()]);
  return <SellersAdmin lang={lang} sellers={sellers} />;
}
