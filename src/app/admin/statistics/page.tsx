import { redirect } from "next/navigation";
import { requireSection } from "@/lib/actions/guard";

/* "Statistics" is gone as a concept. Most of what it showed duplicated the
 * sales dashboard; what was unique to it moved to where it belongs --
 * the pre-sale funnel to /admin/demand, payments to the sales dashboard,
 * marketplace commission to the sellers page.
 *
 * A redirect rather than a deleted route: the tab is gone from the nav, but
 * bookmarks and any link still in the wild should land somewhere useful
 * instead of a 404. */
export default async function StatisticsPage() {
  await requireSection("catalog");
  redirect("/admin/demand");
}
