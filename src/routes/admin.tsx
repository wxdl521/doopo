import { createFileRoute, Outlet } from "@tanstack/react-router";
import { LayoutDashboard, Cpu, Building2, Receipt } from "lucide-react";
import SectionSidebar from "../components/SectionSidebar";
import { useLanguage } from "../i18n/LanguageContext";

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
  const items = [
    { to: "/admin", label: t.admin_overview, icon: LayoutDashboard },
    { to: "/admin/models", label: t.admin_models, icon: Cpu },
    { to: "/admin/tenants", label: t.admin_tenants, icon: Building2 },
    { to: "/admin/billing", label: t.admin_billing, icon: Receipt },
  ];
  return (
    <div className="animate-fade-in flex flex-col md:flex-row gap-6">
      <SectionSidebar title={t.admin_ops} items={items} />
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
