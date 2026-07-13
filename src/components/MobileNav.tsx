import { Link } from "@tanstack/react-router";
import { Home, FolderOpen, FileText, Library, Bookmark, Palette, ShieldCheck, User } from "lucide-react";
import { useLanguage } from "../i18n/LanguageContext";

export default function MobileNav() {
  const { t } = useLanguage();
  const items = [
    { to: "/home", label: t.nav_home, icon: Home },
    { to: "/scripts", label: t.nav_scripts, icon: FileText },
    { to: "/projects", label: t.nav_projects, icon: FolderOpen },
    { to: "/assets", label: t.nav_assets, icon: Library },
    { to: "/bases", label: t.nav_bases, icon: Bookmark },
    { to: "/restyle", label: t.nav_restyle, icon: Palette },
    { to: "/team", label: t.nav_team, icon: ShieldCheck },
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
            <Icon size={18} />
            <span className="text-[10px] font-medium leading-none">{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
