import HeroSlidesAdmin from "@/components/admin/HeroSlidesAdmin";
import { adminHeroSlides } from "@/lib/data/admin";
import { getLiveProducts } from "@/lib/data/public";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function HeroAdminPage() {
  await requireSection("storefront.hero");
  /* The live catalogue for the featured-product picker -- the same list
     the storefront resolves a slide's product against, so the admin can
     only choose something the hero will actually draw. */
  const [lang, slides, products] = await Promise.all([
    getLang(), adminHeroSlides(), getLiveProducts(),
  ]);
  return <HeroSlidesAdmin lang={lang} slides={slides} products={products} />;
}
