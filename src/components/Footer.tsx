import type { Settings } from "@/lib/types";

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

export default function Footer({ settings }: { settings: Settings }) {
  // Most specific string first (landmark) gives Google Maps the best chance
  // of pinning the actual building rather than just the general suco.
  const query = [settings.landmark, settings.suku, settings.municipality, "Timor-Leste"]
    .filter(Boolean)
    .join(", ");
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

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
        WhatsApp {settings.wa_number} · {settings.landmark}
      </div>
    </footer>
  );
}
