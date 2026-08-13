import SellerProductForm from "@/components/seller/SellerProductForm";
import SellerStatusGate from "@/components/seller/SellerStatusGate";
import { getCurrentSellerOrRedirect } from "@/lib/data/seller";
import { getCategories } from "@/lib/data/public";
import { getLang } from "@/lib/lang";

export default async function NewSellerProductPage() {
  const lang = await getLang();
  const seller = await getCurrentSellerOrRedirect();
  const cats = await getCategories();
  return (
    <SellerStatusGate seller={seller} lang={lang}>
      <SellerProductForm lang={lang} cats={cats} product={null} />
    </SellerStatusGate>
  );
}
