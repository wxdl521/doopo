import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronDown, MessageCircle, Sparkles, Sun, Moon, Globe, User, LogOut } from 'lucide-react'
import Logo from './Logo'
import { useTheme } from '../context/ThemeContext'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../hooks/useAuth'

export default function Header() {
  const { theme, toggleTheme } = useTheme()
  const { lang, setLang, t } = useLanguage()
  const { isAuthenticated, loading, user, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLogout = async () => {
    setMenuOpen(false)
    await signOut()
    navigate({ to: '/home' })
  }

  const topLinks = [
    { to: '/zoclaw', label: t.nav_openclaw, accent: true },
    { to: '/team', label: t.nav_team },
    { to: '/admin', label: t.nav_admin },
    { to: '/community', label: '社区' },
    { to: '/showcase', label: t.nav_showcase },
    { to: '/pricing', label: t.nav_pricing },
  ]

  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-bg/70 border-b border-border">
      <div className="flex items-center justify-between gap-2 md:gap-4 px-4 sm:px-6 md:px-10 py-3">
        <div className="flex items-center gap-4 md:gap-8 min-w-0">
          <Logo />
          <nav className="hidden md:flex items-center gap-1 text-sm">
            {topLinks.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className={`px-3 py-1.5 rounded-full transition-all duration-200 ${
                  l.accent
                    ? 'text-accent hover:bg-accent-dim border border-accent/30'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
                activeProps={
                  l.accent
                    ? undefined
                    : { className: '!text-text-primary !bg-bg-elevated' }
                }
              >
                {l.accent && <Sparkles size={12} className="inline mr-1 -mt-0.5" />}
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-1.5 md:gap-3">
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
            className="w-9 h-9 rounded-full flex items-center justify-center border border-border bg-bg-elevated hover:border-accent/50 hover:text-accent text-text-secondary transition flex-shrink-0"
            title={theme === 'light' ? t.header_theme_to_dark : t.header_theme_to_light}
          >
            {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
          </button>

          {/* Language Switcher */}
          <div className="relative group flex-shrink-0">
            <button className="flex items-center gap-1 md:gap-1.5 px-2.5 md:px-3 py-1.5 rounded-full text-sm font-medium border border-border bg-bg-elevated hover:border-accent/50 hover:text-accent text-text-secondary transition">
              <Globe size={14} />
              <span>{lang === 'zh' ? '中文' : lang === 'en' ? 'EN' : lang}</span>
              <ChevronDown size={12} className="group-hover:rotate-180 transition-transform" />
            </button>
            <div className="absolute right-0 top-full mt-1.5 py-1.5 rounded-xl border border-border bg-bg-surface shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 min-w-[120px] max-h-[300px] overflow-y-auto">
              <button onClick={() => setLang('zh')} className={`w-full text-left px-4 py-2 text-sm hover:bg-bg-elevated transition-colors ${lang === 'zh' ? 'text-accent font-semibold' : 'text-text-secondary'}`}>中文</button>
              <button onClick={() => setLang('en')} className={`w-full text-left px-4 py-2 text-sm hover:bg-bg-elevated transition-colors ${lang === 'en' ? 'text-accent font-semibold' : 'text-text-secondary'}`}>EN</button>
              <button onClick={() => setLang('ja')} className={`w-full text-left px-4 py-2 text-sm hover:bg-bg-elevated transition-colors ${lang === 'ja' ? 'text-accent font-semibold' : 'text-text-secondary'}`}>日本語</button>
              <button onClick={() => setLang('ko')} className={`w-full text-left px-4 py-2 text-sm hover:bg-bg-elevated transition-colors ${lang === 'ko' ? 'text-accent font-semibold' : 'text-text-secondary'}`}>한국어</button>
              <button onClick={() => setLang('fr')} className={`w-full text-left px-4 py-2 text-sm hover:bg-bg-elevated transition-colors ${lang === 'fr' ? 'text-accent font-semibold' : 'text-text-secondary'}`}>Français</button>
              <button onClick={() => setLang('es')} className={`w-full text-left px-4 py-2 text-sm hover:bg-bg-elevated transition-colors ${lang === 'es' ? 'text-accent font-semibold' : 'text-text-secondary'}`}>Español</button>
              <button onClick={() => setLang('de')} className={`w-full text-left px-4 py-2 text-sm hover:bg-bg-elevated transition-colors ${lang === 'de' ? 'text-accent font-semibold' : 'text-text-secondary'}`}>Deutsch</button>
              <button onClick={() => setLang('pt')} className={`w-full text-left px-4 py-2 text-sm hover:bg-bg-elevated transition-colors ${lang === 'pt' ? 'text-accent font-semibold' : 'text-text-secondary'}`}>Português</button>
              <button onClick={() => setLang('it')} className={`w-full text-left px-4 py-2 text-sm hover:bg-bg-elevated transition-colors ${lang === 'it' ? 'text-accent font-semibold' : 'text-text-secondary'}`}>Italiano</button>
              <button onClick={() => setLang('ru')} className={`w-full text-left px-4 py-2 text-sm hover:bg-bg-elevated transition-colors ${lang === 'ru' ? 'text-accent font-semibold' : 'text-text-secondary'}`}>Русский</button>
              <button onClick={() => setLang('ar')} className={`w-full text-left px-4 py-2 text-sm hover:bg-bg-elevated transition-colors ${lang === 'ar' ? 'text-accent font-semibold' : 'text-text-secondary'}`}>العربية</button>
              <button onClick={() => setLang('th')} className={`w-full text-left px-4 py-2 text-sm hover:bg-bg-elevated transition-colors ${lang === 'th' ? 'text-accent font-semibold' : 'text-text-secondary'}`}>ไทย</button>
              <button onClick={() => setLang('vi')} className={`w-full text-left px-4 py-2 text-sm hover:bg-bg-elevated transition-colors ${lang === 'vi' ? 'text-accent font-semibold' : 'text-text-secondary'}`}>Tiếng Việt</button>
              <button onClick={() => setLang('id')} className={`w-full text-left px-4 py-2 text-sm hover:bg-bg-elevated transition-colors ${lang === 'id' ? 'text-accent font-semibold' : 'text-text-secondary'}`}>Indonesia</button>
            </div>
          </div>

          <div className="badge-points hidden sm:flex">
            <Sparkles size={14} className="text-accent" />
            <span className="text-text-primary">70</span>
          </div>

          <button className="hidden sm:inline-flex px-4 py-1.5 rounded-full text-sm font-semibold
                             bg-gradient-to-r from-fuchsia-500 to-orange-400 text-white
                             hover:opacity-90 transition shadow-card">
            {t.header_upgrade}
          </button>

          {!loading && !isAuthenticated ? (
            <Link to="/login"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium border border-accent/40 text-accent bg-accent-dim hover:bg-accent/20 transition flex-shrink-0">
              登录
            </Link>
          ) : (
            <div className="relative flex-shrink-0" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="w-9 h-9 rounded-full overflow-hidden border border-border
                           bg-gradient-to-br from-emerald-400 to-cyan-500 hover:ring-2
                           hover:ring-accent/50 transition grid place-items-center"
                aria-label={t.header_account}
              >
                <User size={16} className="text-white" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-2 py-2 rounded-xl border border-border bg-bg-surface shadow-lg min-w-[180px] z-50">
                  <div className="px-4 py-2 border-b border-border">
                    <p className="text-sm font-medium text-text-primary truncate max-w-[160px]">
                      {user?.email || t.header_account}
                    </p>
                  </div>
                  <Link
                    to="/account"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition-colors"
                  >
                    <User size={14} />
                    {t.header_account}
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition-colors text-left"
                  >
                    <LogOut size={14} />
                    {t.header_logout}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
