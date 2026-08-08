import LoginForm from "@/components/admin/LoginForm";
import { getLang } from "@/lib/lang";
import { isLoggedIn } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  if (await isLoggedIn()) redirect("/admin");
  const lang = await getLang();
  return <LoginForm lang={lang} />;
}
