import RegisterForm from "@/components/seller/RegisterForm";
import { getLang } from "@/lib/lang";

export default async function SellerRegisterPage() {
  const lang = await getLang();
  return (
    <div className="wrap" style={{ maxWidth: 560 }}>
      <RegisterForm lang={lang} />
    </div>
  );
}
