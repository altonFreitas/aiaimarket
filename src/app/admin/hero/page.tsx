import HeroSlidesAdmin from "@/components/admin/HeroSlidesAdmin";
import { adminHeroSlides } from "@/lib/data/admin";
import { getLang } from "@/lib/lang";

export default async function HeroAdminPage() {
  const [lang, slides] = await Promise.all([getLang(), adminHeroSlides()]);
  return <HeroSlidesAdmin lang={lang} slides={slides} />;
}
