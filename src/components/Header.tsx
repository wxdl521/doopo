import { Link, NavLink } from '@tanstack/react-router'
import { ChevronDown, MessageCircle, Sparkles, Sun, Moon, Globe } from 'lucide-react'
import Logo from './Logo'
import { useTheme } from '../context/ThemeContext'
import { useLanguage } from '../i18n/LanguageContext'

const topLinks = [
  { to: '/zoclaw', label: 'Openclaw', accent: true },
  { to: '/showcase', label: 'Showcase' },
  { to: '/pricing', label: 'Pricing' },
]

export default function Header() {
  const { theme, toggleTheme } = useTheme()
  const { lang, setLang } = useLanguage()

  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-bg/70 border-b border-border">
      <div className="flex items-center justify-between gap-4 px-6 md:px-10 py-3">
        <div className="flex items-center gap-8">
          <Logo />
          <nav className="hidden md:flex items-center gap-1 text-sm">
            {topLinks.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-full transition-all duration-200 ${
                    l.accent
                      ? 'text-accent hover:bg-accent-dim border border-accent/30'
                      : isActive
                      ? 'text-text-primary bg-bg-elevated'
                      : 'text-text-secondary hover:text-text-primary'
                  }`
                }
              >
                {l.accent && <Sparkles size={12} className="inline mr-1 -mt-0.5" />}
                {l.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <Link
            to="/zoclaw"
            className="hidden sm:inline-flex items-center justify-center w-9 h-9 rounded-full
                       bg-bg-elevated border border-border hover:border-accent/40
                       hover:text-accent text-text-secondary transition"
            title="Discord"
          >
            <MessageCircle size={16} />
          </Link>

          <button
            onClick={toggleTheme}
            className="w-9 h-9 rounded-full flex items-center justify-center border border-border bg-bg-elevated hover:border-accent/50 hover:text-accent text-text-secondary transition"
            title={theme === 'light' ? '切换深色模式' : '切换浅色模式'}
          >
            {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
          </button>

          {/* Language Switcher */}
          <div className="relative group">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border border-border bg-bg-elevated hover:border-accent/50 hover:text-accent text-text-secondary transition">
              <Globe size={14} />
              <span>{lang === 'zh' ? '中文' : 'EN'}</span>
              <ChevronDown size={12} className="group-hover:rotate-180 transition-transform" />
            </button>
            <div className="absolute right-0 top-full mt-1.5 py-1.5 rounded-xl border border-border bg-bg-surface shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 min-w-[100px]">
              <button
                onClick={() => setLang('zh')}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-bg-elevated transition-colors ${lang === 'zh' ? 'text-accent font-semibold' : 'text-text-secondary'}`}
              >
                中文
              </button>
              <button
                onClick={() => setLang('en')}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-bg-elevated transition-colors ${lang === 'en' ? 'text-accent font-semibold' : 'text-text-secondary'}`}
              >
                English
              </button>
            </div>
          </div>

          <div className="badge-points">
            <Sparkles size={14} className="text-accent" />
            <span className="text-text-primary">70</span>
          </div>

          <button className="px-4 py-1.5 rounded-full text-sm font-semibold
                             bg-gradient-to-r from-fuchsia-500 to-orange-400 text-white
                             hover:opacity-90 transition shadow-card">
            Upgrade
          </button>

          <button className="w-9 h-9 rounded-full overflow-hidden border border-border
                             bg-gradient-to-br from-emerald-400 to-cyan-500 hover:ring-2
                             hover:ring-accent/50 transition">
            <span className="sr-only">Account</span>
          </button>
        </div>
      </div>
    </header>
  )
}
