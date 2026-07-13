import { Bot, Film, Music, Palette, ShoppingBag } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useLanguage } from "../i18n/LanguageContext";

export default function QuickActionChips({ onPick }: { onPick?: (label: string) => void }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const actions = [
    { label: t.quick_restyle, icon: Palette, hue: "from-teal-500/30 to-cyan-500/20", to: "/restyle" as const },
    { label: t.quick_story_video, icon: Film, hue: "from-rose-500/30 to-orange-500/20" },
    { label: t.quick_music_mv, icon: Music, hue: "from-fuchsia-500/30 to-violet-500/20" },
    { label: t.quick_product_promo, icon: ShoppingBag, hue: "from-amber-500/30 to-yellow-500/20" },
    { label: t.quick_digital_human, icon: Bot, hue: "from-cyan-500/30 to-blue-500/20" },
  ];
  return (
    <div className="flex flex-wrap items-center justify-center gap-2.5 md:gap-3">
      {actions.map(({ label, icon: Icon, hue, to }) => (
        <button
          key={label}
          onClick={() => (to ? navigate({ to }) : onPick?.(label))}
          className={`group relative chip overflow-hidden`}
        >
          <span
            className={`absolute inset-0 bg-gradient-to-r ${hue} opacity-0
                        group-hover:opacity-100 transition-opacity`}
          />
          <Icon size={14} className="relative text-accent/90" />
          <span className="relative">{label}</span>
        </button>
      ))}
    </div>
  );
}
