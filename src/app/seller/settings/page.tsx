import SellerSettingsForm from "@/components/seller/SellerSettingsForm";
import SellerTotpSettings from "@/components/seller/SellerTotpSettings";
import { getCurrentSellerOrRedirect } from "@/lib/data/seller";
import { getLang } from "@/lib/lang";

export default async function SellerSettingsPage() {
  const lang = await getLang();
  const seller = await getCurrentSellerOrRedirect();
  return (
    <>
      <SellerSettingsForm lang={lang} seller={seller} />
      <SellerTotpSettings lang={lang} initiallyEnabled={seller.totp_enabled} />
    </>
  );
}
