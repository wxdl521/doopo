import { Link } from "@tanstack/react-router";
import { User } from "lucide-react";
import NavHome from "./icons/NavHome";
import NavScript from "./icons/NavScript";
import NavTranscribe from "./icons/NavTranscribe";
import NavProject from "./icons/NavProject";
import NavAssets from "./icons/NavAssets";
import NavBases from "./icons/NavBases";
import NavRestyle from "./icons/NavRestyle";
import NavZoclaw from "./icons/NavZoclaw";
import NavModels from "./icons/NavModels";
import { useLanguage } from "../i18n/LanguageContext";

export default function MobileNav() {
  const { t } = useLanguage();
  const items = [
    { to: "/home", label: t.nav_home, icon: NavHome },
    { to: "/scripts", label: t.nav_scripts, icon: NavScript },
    { to: "/transcribe", label: t.nav_transcribe, icon: NavTranscribe },
    { to: "/projects", label: t.nav_projects, icon: NavProject },
    { to: "/assets", label: t.nav_assets, icon: NavBases },
    { to: "/bases", label: t.nav_bases, icon: NavAssets },
    { to: "/restyle", label: t.nav_restyle, icon: NavRestyle },
    { to: "/zoclaw", label: t.nav_zoclaw, icon: NavZoclaw },
    { to: "/models", label: t.nav_models, icon: NavModels },
    { to: "/account", label: t.nav_me, icon: User },
  ];
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border
                 bg-bg-soft/90 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-stretch overflow-x-auto no-scrollbar">
        {items.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex-1 min-w-[64px] flex flex-col items-center justify-center gap-0.5 py-2
                       text-text-muted hover:text-accent transition"
            activeProps={{ className: "!text-accent" }}
          >
            <Icon size={22} />
            <span className="text-[10px] font-medium leading-none">{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
