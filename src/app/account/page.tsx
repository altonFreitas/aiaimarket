import AccountView from "@/components/AccountView";
import { getLang } from "@/lib/lang";

export default async function AccountPage() {
  const lang = await getLang();
  return <AccountView lang={lang} />;
}
