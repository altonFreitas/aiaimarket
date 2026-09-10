import ReviewsAdmin from "@/components/admin/ReviewsAdmin";
import { adminProductReviews, adminSellerRatings, adminProducts, adminSellers } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";
import { canSee } from "@/lib/adminSections";

/** What customers have written, and the only way to take any of it down.
 *
 * Guarded on Catalog because product reviews are the bulk of it and they
 * are a property of a product. The store-ratings half is shown only to
 * somebody who also holds Sellers -- the action behind it checks the same
 * thing, so this is not the lock, it is not drawing a list nobody on this
 * account can act on. */
export default async function AdminReviewsPage() {
  const actor = await requireSection("catalog");
  const [lang, reviews, ratings, products, sellers] = await Promise.all([
    getLang(), adminProductReviews(), adminSellerRatings(), adminProducts(), adminSellers(),
  ]);

  // Names, so a moderator reads "Sapatu Merah" rather than a UUID. Built
  // here rather than joined in the query: both lists are already loaded
  // for other screens and React's cache() means this costs nothing extra.
  const productNames = Object.fromEntries(products.map((p) => [p.id, p.name]));
  const sellerNames = Object.fromEntries(sellers.map((s) => [s.id, s.store_name]));

  return (
    <ReviewsAdmin
      lang={lang}
      reviews={reviews}
      ratings={canSee(actor, "sellers") ? ratings : null}
      productNames={productNames}
      sellerNames={sellerNames}
    />
  );
}
