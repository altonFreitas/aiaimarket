import type { Lang, Settings } from "@/lib/types";
import { waLink, waNumberDigits } from "@/lib/utils";
import { t } from "@/lib/i18n";
import Link from "next/link";

function LocationIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ display: "inline", verticalAlign: "-2px", marginRight: 3 }}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
      style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }}>
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 2a8 8 0 1 1-4.1 14.8l-.3-.2-2.6.7.7-2.5-.2-.3A8 8 0 0 1 12 4zm-3.2 4c-.2 0-.5.1-.7.4-.3.3-.9.9-.9 2.1 0 1.2.9 2.4 1 2.6.1.2 1.7 2.8 4.3 3.8 2.1.8 2.5.7 3 .6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.7-.4-1.4-.7c-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1-.2-.1-1-.4-1.9-1.2-.7-.6-1.2-1.4-1.3-1.6-.1-.2 0-.3.1-.4l.4-.5.3-.5v-.4l-.7-1.6c-.2-.4-.4-.4-.5-.4h-.1z" />
    </svg>
  );
}

export default function Footer({ settings, lang }: { settings: Settings; lang: Lang }) {
  // Most specific string first (landmark) gives Google Maps the best chance
  // of pinning the actual building rather than just the general suco.
  const query = [settings.landmark, settings.suku, settings.municipality, "Timor-Leste"]
    .filter(Boolean)
    .join(", ");
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  const waHref = waLink(waNumberDigits(settings), "Botardi!");

  return (
    <footer className="ft">
      <div>
        <b>{settings.store_name}</b> ·{" "}
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener"
          style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}
        >
          <LocationIcon />
          {settings.suku}, {settings.municipality}
        </a>{" "}
        · {settings.hours}
      </div>
      <div className="mono">
        <a
          href={waHref}
          target="_blank"
          rel="noopener"
          style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}
        >
          <WhatsAppIcon />
          WhatsApp {settings.wa_number}
        </a>
      </div>
      <div style={{ marginTop: 6 }}>
        <Link href="/seller/register" style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 2, fontSize: 12 }}>
          {t("becomeSeller", lang)}
        </Link>
      </div>
    </footer>
  );
}
