import ShowcaseGrid from "../components/ShowcaseGrid";
import { useLanguage } from "../i18n/LanguageContext";

export default function Showcase() {
  const { t } = useLanguage();
  return (
    <div className="animate-fade-in">
      <div className="mb-8 max-w-3xl">
        <h1 className="font-display text-3xl md:text-4xl font-bold">{t.showcase_title}</h1>
        <p className="text-text-secondary mt-2">{t.showcase_subtitle}</p>
      </div>
      <ShowcaseGrid initial="All" />
    </div>
  );
}
