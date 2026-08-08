import BasketView from "@/components/BasketView";
import { getLang } from "@/lib/lang";

export default async function ListPage() {
  const lang = await getLang();
  return <BasketView lang={lang} />;
}
