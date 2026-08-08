import type { Settings } from "@/lib/types";

export default function Footer({ settings }: { settings: Settings }) {
  return (
    <footer className="ft">
      <div>
        <b>{settings.store_name}</b> · {settings.suku}, {settings.municipality} · {settings.hours}
      </div>
      <div className="mono">
        WhatsApp {settings.wa_number} · {settings.landmark}
      </div>
    </footer>
  );
}
