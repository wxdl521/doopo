import { createFileRoute } from "@tanstack/react-router";
import { Building2, Cpu, DollarSign, Activity } from "lucide-react";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { mockTenants, mockAdminModels, mockInvoices } from "../data/mock";
import { useLanguage } from "../i18n/LanguageContext";

export const Route = createFileRoute("/admin/")({
  component: AdminOverview,
});

function AdminOverview() {
  const { t } = useLanguage();
  const mrr = mockInvoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount, 0);
  const online = mockAdminModels.filter((m) => m.status === "online").length;
  return (
    <>
      <PageHeader title={t.admin_overview_title} subtitle={t.admin_overview_sub} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={Building2}
          label={t.admin_tenants_metric}
          value={mockTenants.length}
          hint={`${mockTenants.filter((tn) => tn.status === "pending").length} ${t.admin_tenants_pending}`}
          tone="default"
        />
        <StatCard
          icon={Cpu}
          label={t.admin_models_online}
          value={`${online}/${mockAdminModels.length}`}
          tone={online === mockAdminModels.length ? "success" : "warning"}
        />
        <StatCard
          icon={DollarSign}
          label={t.admin_mrr}
          value={`$${mrr.toLocaleString()}`}
          tone="success"
        />
        <StatCard
          icon={Activity}
          label={t.admin_failed_payments}
          value={mockInvoices.filter((i) => i.status === "failed").length}
          tone="danger"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="panel p-6">
          <h3 className="font-display text-lg font-bold mb-4">{t.admin_recent_tenants}</h3>
          <ul className="divide-y divide-border">
            {mockTenants.slice(0, 4).map((tn) => (
              <li key={tn.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold">{tn.company}</div>
                  <div className="text-xs text-text-muted">
                    {tn.contact} · {tn.seats} {t.admin_seats_suffix}
                  </div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-bg-elevated border border-border capitalize">
                  {tn.plan}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel p-6">
          <h3 className="font-display text-lg font-bold mb-4">{t.admin_model_latency}</h3>
          <ul className="space-y-3">
            {mockAdminModels.map((m) => (
              <li key={m.id} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs">{m.name}</span>
                <span
                  className={
                    m.status === "online"
                      ? "text-emerald-500"
                      : m.status === "degraded"
                        ? "text-amber-500"
                        : "text-rose-500"
                  }
                >
                  {m.status === "offline" ? t.common_offline.toLowerCase() : `${m.latencyMs} ms`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
