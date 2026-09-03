import { createFileRoute, Link } from "@tanstack/react-router";
import PageHeader from "../components/PageHeader";
import { useLanguage } from "../i18n/LanguageContext";

export const Route = createFileRoute("/account/subscription")({
  component: AccountSubscription,
});

function AccountSubscription() {
  const { t } = useLanguage();
  return (
    <>
      <PageHeader title={t.account_subscription} subtitle={t.account_subscription_sub} />
      <section className="panel p-6 mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted">
            {t.account_current_plan}
          </div>
          <div className="font-display text-2xl font-bold mt-1">{t.account_subscription_none}</div>
          <div className="text-sm text-text-secondary mt-1 max-w-xl">
            {t.account_subscription_none_desc}
          </div>
        </div>
        <div className="flex gap-2">
          <Link to="/account/credits" className="btn-primary">
            {t.account_go_credits}
          </Link>
          <Link to="/pricing" className="btn-ghost">
            {t.account_upgrade}
          </Link>
        </div>
      </section>
    </>
  );
}
