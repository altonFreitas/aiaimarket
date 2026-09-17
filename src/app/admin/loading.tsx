import Skeleton, { Sk, SkRows } from "@/components/ui/Skeleton";
import { getLang } from "@/lib/lang";

/* Every /admin/* route, because a loading.tsx covers its whole segment.
 *
 * These screens are the slowest in the app -- an order book or a finance
 * page aggregates several tables -- and they were the ones showing nothing
 * at all while they did it: the previous admin page stayed on screen,
 * complete and wrong, until the new one replaced it. On a shop phone that
 * reads as a tab that did not respond, and the tab gets pressed again.
 *
 * The shape is the shape these pages actually have: four figures across
 * the top, then a table. */
export default async function Loading() {
  const lang = await getLang();
  return (
    <Skeleton lang={lang}>
      <div className="stat">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i}>
            <Sk h={24} w="60%" />
            <Sk h={11} w="80%" />
          </div>
        ))}
      </div>
      <div className="panel">
        <Sk className="sk-title" w="30%" />
        <SkRows n={6} />
      </div>
    </Skeleton>
  );
}
