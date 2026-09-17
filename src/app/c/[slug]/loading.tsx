import Skeleton, { SkGrid } from "@/components/ui/Skeleton";
import { getLang } from "@/lib/lang";

/* Shown the moment a shopper taps through to this listing, and replaced
 * when the products land. Before it, the browser held the page they had
 * just left -- so a slow connection looked like a tap that missed. */
export default async function Loading() {
  const lang = await getLang();
  return (
    <div className="wrap">
      <Skeleton lang={lang}>
        <SkGrid n={8} />
      </Skeleton>
    </div>
  );
}
