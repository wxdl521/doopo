import { useState, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import PromoBanner from "../components/PromoBanner";
import Footer from "../components/Footer";
import MobileNav from "../components/MobileNav";
import AuthGate from "../components/AuthGate";

export default function MainLayout({ children }: { children: ReactNode }) {
  const [showPromo, setShowPromo] = useState(true);
  const location = useLocation();
  const isRestyle = location.pathname.startsWith("/restyle");
  const isWorkspace = location.pathname.startsWith("/workspace/");

  if (isRestyle) {
    return (
      <div className="flex min-h-screen bg-bg">
        <Sidebar fullHeight />
        <main className="min-w-0 flex-1">
          <AuthGate>{children}</AuthGate>
        </main>
      </div>
    );
  }

  if (isWorkspace) {
    // Workspace owns its own full-screen chrome (top bar + chat panel).
    return (
      <div className="min-h-screen flex flex-col bg-bg">
        <AuthGate>{children}</AuthGate>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {showPromo && <PromoBanner onClose={() => setShowPromo(false)} />}
      <Header />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 px-4 sm:px-6 md:px-10 lg:px-14 py-5 md:py-8 pb-24 md:pb-8">
          <AuthGate>{children}</AuthGate>
          <Footer />
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
