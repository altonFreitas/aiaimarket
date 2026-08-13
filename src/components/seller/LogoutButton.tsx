"use client";
import { useRouter } from "next/navigation";
import { logoutSeller } from "@/lib/actions/seller-auth";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

export default function LogoutButton({ lang }: { lang: Lang }) {
  const router = useRouter();
  return (
    <button className="btn btn-ghost btn-sm" type="button" onClick={async () => {
      await logoutSeller();
      router.push("/seller/login");
      router.refresh();
    }}>
      {t("logOut", lang)}
    </button>
  );
}
