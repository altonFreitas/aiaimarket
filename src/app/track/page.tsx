import TrackForm from "@/components/TrackForm";
import { getLang } from "@/lib/lang";
import { getApprovedSellersById } from "@/lib/data/public";

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const sp = await searchParams;
  const [lang, sellersById] = await Promise.all([getLang(), getApprovedSellersById()]);
  return <TrackForm lang={lang} initialRef={sp.ref || ""} sellersById={sellersById} />;
}
