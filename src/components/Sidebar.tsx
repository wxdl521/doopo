import { Link } from "@tanstack/react-router";
import {
  Home,
  FolderOpen,
  Bookmark,
  Sparkles,
  WandSparkles,
  Mail,
  Headphones,
  FileText,
  Library,
  Palette,
  AudioLines,
} from "lucide-react";
import { useLanguage } from "../i18n/LanguageContext";

export default function Sidebar({ fullHeight = false }: { fullHeight?: boolean }) {
  const { t } = useLanguage();

  const items = [
    { to: "/home", label: t.nav_home, icon: Home },
    { to: "/scripts", label: t.nav_scripts, icon: FileText },
    { to: "/transcribe", label: t.nav_transcribe, icon: AudioLines },
    { to: "/projects", label: t.nav_projects, icon: FolderOpen },
    { to: "/assets", label: t.nav_assets, icon: Library },
    { to: "/bases", label: t.nav_bases, icon: Bookmark },
    { to: "/restyle", label: t.nav_restyle, icon: Palette },
    { to: "/zoclaw", label: t.nav_zoclaw, icon: WandSparkles },
    { to: "/models", label: t.nav_models, icon: Sparkles },
  ];

  const footerItems = [
    { to: "#", label: t.nav_support, icon: Headphones },
    { to: "#", label: t.nav_contact, icon: Mail },
  ];

  return (
    <aside
      className={`hidden w-[88px] flex-col items-center justify-between gap-4 border-r border-border bg-bg-soft/50 py-6 backdrop-blur-sm md:flex ${
        fullHeight ? "sticky top-0 h-screen self-start" : "sticky top-[57px] self-start"
      }`}
      style={fullHeight ? undefined : { height: "calc(100vh - 57px)" }}
    >
      <nav className="flex flex-col items-center gap-2">
        {items.map(({ to, label, icon: Icon }, i) => (
          <Link
            key={to}
            to={to}
            className="nav-item"
            activeProps={{ className: "nav-item nav-item-active" }}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <Icon size={20} />
            <span className="text-[10px] font-medium leading-tight whitespace-pre text-center">
              {label}
            </span>
          </Link>
        ))}
      </nav>

      <div className="w-10 h-px bg-border" />

      <nav className="flex flex-col items-center gap-2 mb-2">
        {footerItems.map(({ to, label, icon: Icon }) => (
          <a key={label} href={to} className="nav-item" title={label}>
            <Icon size={18} />
          </a>
        ))}
      </nav>
    </aside>
  );
}
