import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import SellerNav from "@/components/seller/SellerNav";
import { normalizeFeatures } from "@/lib/sellerFeatures";
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

  // Which tabs this store holds. Read here rather than in the nav because
  // the nav is a client component and this is the seller's own row: the
  // browser never gets to say what it has been granted.
  //
  // A store whose row cannot be read -- or a database that has not run
  // supabase/seller-features.sql -- comes back as nothing extra, which is
  // the four included tabs. Failing closed here costs a seller a screen
  // they may have paid for; failing open would hand every store on the
  // marketplace something the owner sells.
  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from("sellers").select("features").eq("user_id", user.id).maybeSingle();

  return (
    <div className="wrap">
      <SellerNav lang={lang} features={normalizeFeatures(row?.features)} />
      {children}
    </div>
  );
}
