import { NavLink } from 'react-router-dom'
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
} from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'

const footerItems = [
  { to: '#', label: 'Support', icon: Headphones },
  { to: '#', label: 'Contact', icon: Mail },
]

export default function Sidebar() {
  const { t } = useLanguage()

  const items = [
    { to: '/home', label: t.nav_home, icon: Home },
    { to: '/projects', label: 'Projects', icon: FolderOpen },
    { to: '/scripts', label: t.nav_scripts, icon: FileText },
    { to: '/characters', label: t.nav_characters, icon: Users },
    { to: '/bases', label: 'Assets', icon: Bookmark },
    { to: '/zoclaw', label: 'ZoClaw', icon: WandSparkles },
    { to: '/models', label: t.nav_models, icon: Sparkles },
  ]

  return (
    <aside className="hidden md:flex flex-col items-center justify-between gap-4
                      w-[88px] py-6 border-r border-border bg-bg-soft/50 backdrop-blur-sm
                      sticky top-[57px] self-start"
           style={{ height: 'calc(100vh - 57px)' }}>
      <nav className="flex flex-col items-center gap-2">
        {items.map(({ to, label, icon: Icon }, i) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `nav-item ${isActive ? 'nav-item-active' : ''}`
            }
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <Icon size={20} />
            <span className="text-[10px] font-medium leading-tight whitespace-pre text-center">
              {label}
            </span>
          </NavLink>
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
