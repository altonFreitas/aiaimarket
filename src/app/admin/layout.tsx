import { isLoggedIn } from "@/lib/session";
import AdminNav from "@/components/admin/AdminNav";
import { getLang } from "@/lib/lang";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  const loggedIn = await isLoggedIn();

  // The login page renders inside this layout too, so only show the nav
  // once there is a verified session. Middleware handles the redirect.
  if (!loggedIn) return <>{children}</>;

  return (
    <div className="wrap">
      <AdminNav lang={lang} />
      {children}
    </div>
  );
}
