import Skeleton, { Sk } from "@/components/ui/Skeleton";
import { getLang } from "@/lib/lang";

/* The product page, in outline: the photo on the left, the title, price and
 * the buy button on the right. Laid out with the real page's own grid so
 * nothing moves sideways when the product arrives. */
export default async function Loading() {
  const lang = await getLang();
  return (
    <div className="wrap">
      <Skeleton lang={lang}>
        <div className="pdp">
          <Sk className="sk-ph" />
          <div>
            <Sk className="sk-title" w="70%" h={22} />
            <Sk className="sk-title" w="40%" h={22} />
            <Sk className="sk-price" h={28} />
            <Sk className="sk-row" />
            <Sk className="sk-row" />
          </div>
        </div>
      </Skeleton>
    </div>
  );
}
