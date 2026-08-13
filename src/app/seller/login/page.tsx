import SellerLoginForm from "@/components/seller/SellerLoginForm";
import { getLang } from "@/lib/lang";

export default async function SellerLoginPage() {
  const lang = await getLang();
  return (
    <div className="wrap" style={{ maxWidth: 480 }}>
      <SellerLoginForm lang={lang} />
    </div>
  );
}
