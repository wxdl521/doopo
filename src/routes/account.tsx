import { createFileRoute, Outlet } from "@tanstack/react-router";
import {
  User,
  CreditCard,
  FolderOpen,
  Award,
  Bell,
  Share2,
  ShieldCheck,
  Coins,
  AlertTriangle,
} from "lucide-react";
import SectionSidebar from "../components/SectionSidebar";
import { RequireAuth } from "../components/RequireAuth";
import { useLanguage } from "../i18n/LanguageContext";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Account — Doopoo" }] }),
  component: AccountLayout,
});

function AccountLayout() {
  const { t } = useLanguage();
  const items = [
    { to: "/account", label: t.account_overview, icon: User },
    { to: "/account/subscription", label: t.account_subscription, icon: CreditCard },
    { to: "/account/credits", label: t.account_credits, icon: Coins },
    { to: "/account/assets", label: t.account_assets, icon: FolderOpen },
    { to: "/account/posts", label: t.account_posts, icon: Share2 },
    { to: "/account/rewards", label: t.account_rewards, icon: Award },
    { to: "/account/notifications", label: t.account_notifications, icon: Bell },
    { to: "/account/security", label: t.account_security, icon: ShieldCheck },
    { to: "/account/error-logs", label: t.account_error_logs, icon: AlertTriangle },
  ];
  return (
    <RequireAuth>
      <div className="animate-fade-in flex flex-col md:flex-row gap-6">
        <SectionSidebar title={t.account_title} items={items} />
        <div className="flex-1 min-w-0">
          <Outlet />
        </div>
      </div>
    </RequireAuth>
  );
}
