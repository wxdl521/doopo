import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import PageHeader from "../components/PageHeader";
import { mockTenants, type Tenant } from "../data/mock";
import { useLanguage } from "../i18n/LanguageContext";

export const Route = createFileRoute("/admin/tenants")({
  component: AdminTenants,
});

const statusTone: Record<Tenant["status"], string> = {
  active: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30",
  pending: "text-amber-500 bg-amber-500/10 border-amber-500/30",
  suspended: "text-rose-500 bg-rose-500/10 border-rose-500/30",
};

function AdminTenants() {
  const { t } = useLanguage();
  const [items, setItems] = useState(mockTenants);
  const setStatus = (id: string, status: Tenant["status"]) =>
    setItems((prev) => prev.map((tn) => (tn.id === id ? { ...tn, status } : tn)));
  const statusLabel: Record<Tenant["status"], string> = {
    active: t.common_active,
    pending: t.common_pending,
    suspended: t.common_suspended,
  };
  return (
    <>
      <PageHeader title={t.admin_tenants_title} subtitle={t.admin_tenants_sub} />
      <section className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated/60 text-text-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t.admin_col_company}</th>
              <th className="text-left px-4 py-3 font-medium">{t.admin_col_plan}</th>
              <th className="text-right px-4 py-3 font-medium">{t.admin_col_seats}</th>
              <th className="text-left px-4 py-3 font-medium">{t.common_status}</th>
              <th className="text-left px-4 py-3 font-medium">{t.admin_col_created}</th>
              <th className="text-left px-4 py-3 font-medium">{t.admin_col_contact}</th>
              <th className="text-right px-4 py-3 font-medium">{t.common_actions}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((tn) => (
              <tr key={tn.id} className="border-t border-border">
                <td className="px-4 py-3 font-semibold">{tn.company}</td>
                <td className="px-4 py-3 capitalize">{tn.plan}</td>
                <td className="px-4 py-3 text-right font-mono">{tn.seats}</td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs border ${statusTone[tn.status]}`}
                  >
                    {statusLabel[tn.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-muted">{tn.created}</td>
                <td className="px-4 py-3 font-mono text-xs">{tn.contact}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-2 justify-end">
                    {tn.status !== "active" && (
                      <button
                        onClick={() => setStatus(tn.id, "active")}
                        className="btn-primary !py-1 !px-3 text-xs"
                      >
                        {t.admin_activate}
                      </button>
                    )}
                    {tn.status !== "suspended" && (
                      <button
                        onClick={() => setStatus(tn.id, "suspended")}
                        className="btn-ghost !py-1 !px-3 text-xs"
                      >
                        {t.admin_suspend}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
