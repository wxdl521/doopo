import { Link } from '@tanstack/react-router'
import {
  Home,
  FolderOpen,
  Bookmark,
  Sparkles,
  WandSparkles,
  Mail,
  Headphones,
  FileText,
  Users,
  Shield,
  Settings2,
  Gift,
} from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'

export default function Sidebar() {
  const { t, lang } = useLanguage()
  const zh = lang === 'zh'

  const items = [
    { to: '/home', label: t.nav_home, icon: Home },
    { to: '/projects', label: t.nav_projects, icon: FolderOpen },
    { to: '/scripts', label: t.nav_scripts, icon: FileText },
    { to: '/characters', label: t.nav_characters, icon: Users },
    { to: '/bases', label: t.nav_bases, icon: Bookmark },
    { to: '/zoclaw', label: t.nav_zoclaw, icon: WandSparkles },
    { to: '/models', label: t.nav_models, icon: Sparkles },
    { to: '/team', label: zh ? '团队' : 'Team', icon: Shield },
    { to: '/rewards', label: zh ? '激励' : 'Rewards', icon: Gift },
    { to: '/admin', label: zh ? '后台' : 'Admin', icon: Settings2 },
  ]

  const footerItems = [
    { to: '#', label: t.nav_support, icon: Headphones },
    { to: '#', label: t.nav_contact, icon: Mail },
  ]

  return (
    <aside className="hidden md:flex flex-col items-center justify-between gap-4
                      w-[88px] py-6 border-r border-border bg-bg-soft/50 backdrop-blur-sm
                      sticky top-[57px] self-start"
           style={{ height: 'calc(100vh - 57px)' }}>
      <nav className="flex flex-col items-center gap-2">
        {items.map(({ to, label, icon: Icon }, i) => (
          <Link
            key={to}
            to={to}
            className="nav-item"
            activeProps={{ className: 'nav-item nav-item-active' }}
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
  )
}
