import { useState } from 'react'
import { Outlet } from '@tanstack/react-router'
import Sidebar from '../components/Sidebar'
import Header from '../components/Header'
import PromoBanner from '../components/PromoBanner'
import Footer from '../components/Footer'

export default function MainLayout() {
  const [showPromo, setShowPromo] = useState(true)

  return (
    <div className="min-h-screen flex flex-col">
      {showPromo && <PromoBanner onClose={() => setShowPromo(false)} />}
      <Header />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 px-6 md:px-10 lg:px-14 py-8">
          <Outlet />
          <Footer />
        </main>
      </div>
    </div>
  )
}
