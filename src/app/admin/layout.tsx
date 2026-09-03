import { currentActor } from "@/lib/session";
import AdminNav from "@/components/admin/AdminNav";
import { AccessProvider } from "@/components/admin/Access";
import { getLang } from "@/lib/lang";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  const actor = await currentActor();

  // The login page renders inside this layout too, so only show the nav
  // once there is a verified session. Middleware handles the redirect.
  //
  // currentActor() rather than isLoggedIn() because the nav now needs to
  // know WHICH sections to show. It is deduped per request, so asking here
  // and again in each page's guard is one lookup, not two.
  if (!actor) return <>{children}</>;

  // Every client component below can now ask what this person may do,
  // without the answer being threaded through twenty files as a prop. It
  // decides what to SHOW; the server still decides what is allowed.
  return (
    <AccessProvider access={actor}>
      <div className="wrap">
        <AdminNav lang={lang} access={actor} />
        {children}
      </div>
    </AccessProvider>
  );
}
