import SellerProductList from "@/components/seller/SellerProductList";
import SellerStatusGate from "@/components/seller/SellerStatusGate";
import { getCurrentSellerOrRedirect, getSellerProducts } from "@/lib/data/seller";
import { getCategories } from "@/lib/data/public";
import { getLang } from "@/lib/lang";

export default async function SellerProductsPage() {
  const lang = await getLang();
  const seller = await getCurrentSellerOrRedirect();
  const [products, cats] = await Promise.all([
    seller.status === "approved" ? getSellerProducts(seller.id) : Promise.resolve([]),
    getCategories(),
  ]);
  return (
    <SellerStatusGate seller={seller} lang={lang}>
      <SellerProductList lang={lang} products={products} cats={cats} />
    </SellerStatusGate>
  );
}
