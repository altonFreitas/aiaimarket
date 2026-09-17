import type { Lang, Settings } from "@/lib/types";
import { t } from "@/lib/i18n";
import Link from "next/link";
import MapLink from "./MapLink";

export default function Footer({ settings, lang }: { settings: Settings; lang: Lang }) {
  return (
    <footer className="ft">
      <div>
        <b>{settings.store_name}</b> ·{" "}
        {/* Most specific string first (landmark) gives the map its best
            chance of pinning the actual building rather than the suco. */}
        <MapLink
          parts={[settings.landmark, settings.suku, settings.municipality, "Timor-Leste"]}
          label={`${settings.suku}, ${settings.municipality}`} />{" "}
        · {settings.hours}
      </div>
      {/* The shop's WhatsApp number used to sit here and was commented out.
          Removed rather than left commented: the number is in the topbar and
          on every product page, and dead JSX is a thing the next person has
          to decide about. `git log` remembers it. */}
      {/* The policy pages. A shop taking money and holding addresses needs
          these reachable from every page, and most payment providers ask
          to see them before approving a merchant account. */}
      <nav className="foot-legal">
        <Link href="/legal/terms">{t("termsTitle", lang)}</Link>
        <Link href="/legal/privacy">{t("privacyTitle", lang)}</Link>
        <Link href="/legal/returns">{t("returnsTitle", lang)}</Link>
      </nav>

      {/* NO "BECOME A SELLER" LINK ANY MORE. Registering a store is by
          invitation (supabase/seller-invites.sql): the owner sends a link
          to the person who asked, and a public link here would lead every
          visitor to a page telling them they need one. An existing seller
          already has a way in through the person icon in the header, which
          handles login for everyone. */}
    </footer>
  );
}
