import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { zh, type Translations, type Lang } from './zh'
import { en } from './en'

const translations: Record<Lang, Translations> = { zh, en }

interface LanguageContextType {
  lang: Lang
  t: Translations
  setLang: (lang: Lang) => void
  toggleLang: () => void
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'zh',
  t: zh,
  setLang: () => {},
  toggleLang: () => {},
})

export function useLanguage() {
  return useContext(LanguageContext)
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === 'undefined') return 'zh'
    return (window.localStorage.getItem('doopoo-lang') as Lang) || 'zh'
  })

  const setLang = (l: Lang) => {
    setLangState(l)
    if (typeof window !== 'undefined') window.localStorage.setItem('doopoo-lang', l)
  }

  const toggleLang = () => {
    setLang(lang === 'zh' ? 'en' : 'zh')
  }

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  return (
    <LanguageContext.Provider value={{ lang, t: translations[lang], setLang, toggleLang }}>
      {children}
    </LanguageContext.Provider>
  )
}
