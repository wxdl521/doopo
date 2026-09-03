import { Link } from "@tanstack/react-router";
import ConstellationCanvas from "../components/landing/ConstellationCanvas";
import { useLanguage } from "../i18n/LanguageContext";

export default function Landing() {
  const { t } = useLanguage();

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#0e151c] text-[#e8f0f6]">
      <ConstellationCanvas />
      <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-6 pointer-events-none">
        <h1 className="font-display text-center text-4xl font-bold tracking-tight md:text-6xl">
          {t.hero_title_line1} <span className="gradient-text">{t.hero_title_line2}</span>
        </h1>
        <Link
          to="/home"
          className="pointer-events-auto mt-10 inline-flex items-center justify-center rounded-full bg-doopoo-gradient px-10 py-3.5 text-base font-semibold tracking-[0.28em] text-[#0a1214] shadow-[0_0_32px_rgba(89,201,213,0.32)] transition-transform hover:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#59c9d5] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e151c]"
        >
          {t.landing_cta}
        </Link>
      </div>
    </main>
  );
}
