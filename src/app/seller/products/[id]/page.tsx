import { notFound } from "next/navigation";
import SellerProductForm from "@/components/seller/SellerProductForm";
import SellerStatusGate from "@/components/seller/SellerStatusGate";
import { getCurrentSellerOrRedirect, getOwnSellerProduct } from "@/lib/data/seller";
import { getCategories } from "@/lib/data/public";
import { getLang } from "@/lib/lang";

export default async function EditSellerProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang = await getLang();
  const seller = await getCurrentSellerOrRedirect();
  const cats = await getCategories();

  if (seller.status !== "approved") {
    return <SellerStatusGate seller={seller} lang={lang}><></></SellerStatusGate>;
  }

  const product = await getOwnSellerProduct(seller.id, id);
  if (!product) notFound();

  return <SellerProductForm lang={lang} cats={cats} product={product} />;
}
