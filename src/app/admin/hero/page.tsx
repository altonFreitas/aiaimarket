import HeroSlidesAdmin from "@/components/admin/HeroSlidesAdmin";
import { adminHeroSlides } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";
import { requireSection } from "@/lib/actions/guard";

export default async function HeroAdminPage() {
  await requireSection("storefront");
  const [lang, slides] = await Promise.all([getLang(), adminHeroSlides()]);
  return <HeroSlidesAdmin lang={lang} slides={slides} />;
}
