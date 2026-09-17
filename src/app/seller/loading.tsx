import Skeleton, { Sk, SkRows } from "@/components/ui/Skeleton";
import { getLang } from "@/lib/lang";

/* Every /seller/* route. Same reasoning as the admin's, and the same shape
 * -- a store's Today and My orders screens are the admin's pages with one
 * shop's figures in them. */
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
        <SkRows n={5} />
      </div>
    </Skeleton>
  );
}
