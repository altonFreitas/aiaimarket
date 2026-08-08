import TrackForm from "@/components/TrackForm";
import { getLang } from "@/lib/lang";

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const sp = await searchParams;
  const lang = await getLang();
  return <TrackForm lang={lang} initialRef={sp.ref || ""} />;
}
