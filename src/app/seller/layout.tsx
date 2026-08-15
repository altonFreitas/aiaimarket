import { supabaseServer } from "@/lib/supabase/server";
import SellerNav from "@/components/seller/SellerNav";
import { getLang } from "@/lib/lang";

/** Mirrors admin/layout.tsx exactly: the nav only shows once there's a
 * verified session, so /seller/register (which also renders inside this
 * layout) stays unnavigated and keeps its own custom ".wrap" width.
 * /seller/login no longer has its own form — it just redirects to the
 * unified /account entry point. Every authenticated /seller/* page does
 * NOT provide its own ".wrap" -- this layout is the single source of
 * it, same as app/admin/layout.tsx. */
export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();

  if (!user) return <>{children}</>;

  return (
    <div className="wrap">
      <SellerNav lang={lang} />
      {children}
    </div>
  );
}
