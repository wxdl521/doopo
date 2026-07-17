import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Coins } from "lucide-react";
import SectionSidebar from "../components/SectionSidebar";
import { useLanguage } from "../i18n/LanguageContext";
import { useAuth } from "../hooks/useAuth";
import { getAdminAccess } from "../lib/adminCredits.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Doopoo" },
      { name: "description", content: "Platform operations console." },
    ],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const { t } = useLanguage();
  const { isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const callAdminAccess = useServerFn(getAdminAccess);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) {
      setHasAccess(false);
      void navigate({ to: "/home", replace: true });
      return;
    }
    callAdminAccess({ data: undefined })
      .then((result: any) => {
        const allowed = result?.isAdmin === true;
        setHasAccess(allowed);
        if (!allowed) void navigate({ to: "/home", replace: true });
      })
      .catch(() => {
        setHasAccess(false);
        void navigate({ to: "/home", replace: true });
      });
  }, [loading, isAuthenticated, callAdminAccess, navigate]);

  const items = [{ to: "/admin/credits", label: t.admin_credits, icon: Coins }];
  if (loading || hasAccess !== true) {
    return <div className="py-16 text-center text-text-muted">{t.admin_checking_access}</div>;
  }

  return (
    <div className="animate-fade-in flex flex-col md:flex-row gap-6">
      <SectionSidebar title={t.nav_admin} items={items} />
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
