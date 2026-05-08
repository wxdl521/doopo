import { useState, type ReactNode } from 'react'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import PromoBanner from '../components/PromoBanner'
import Footer from '../components/Footer'
import MobileNav from '../components/MobileNav'

export default function MainLayout({ children }: { children: ReactNode }) {
  const [showPromo, setShowPromo] = useState(true)

  return (
    <div className="min-h-screen flex flex-col">
      {showPromo && <PromoBanner onClose={() => setShowPromo(false)} />}
      <Header />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 px-4 sm:px-6 md:px-10 lg:px-14 py-5 md:py-8 pb-24 md:pb-8">
          {children}
          <Footer />
        </main>
      </div>
      <MobileNav />
    </div>
  )
}
