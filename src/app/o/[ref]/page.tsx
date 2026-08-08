import TrackForm from "@/components/TrackForm";
import { getLang } from "@/lib/lang";
import { getSettings } from "@/lib/data/public";

/** The dashboard itself is gated: the page renders the ref+phone form,
 * and only after lookupOrder() verifies the phone does the order appear.
 * Nothing about the order is ever sent to the browser before that. */
export default async function OrderPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const [lang, settings] = await Promise.all([getLang(), getSettings()]);
  return <TrackForm lang={lang} initialRef={ref} settings={settings} />;
}
