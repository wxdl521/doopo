import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Gift, Users, Clock, Coins } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { Button } from "@/components/ui/button";
import { getMyReferralOverview, type ReferralOverview } from "../lib/referrals.functions";
import { useLanguage } from "../i18n/LanguageContext";

export const Route = createFileRoute("/account/invite")({
  component: AccountInvite,
});

function AccountInvite() {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "zh-CN";
  const callOverview = useServerFn(getMyReferralOverview);
  const [data, setData] = useState<ReferralOverview | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    callOverview({ data: undefined })
      .then((r) => setData(r))
      .catch(() =>
        setData({
          unavailable: true,
          code: null,
          invitedCount: 0,
          pendingCount: 0,
          rewardedCount: 0,
          skippedCount: 0,
          myRewardTotal: 0,
          invitees: [],
        }),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callOverview identity is not stable
  }, []);

  const link = useMemo(() => {
    if (!data?.code || typeof window === "undefined") return "";
    return `${window.location.origin}/register?ref=${data.code}`;
  }, [data?.code]);

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const el = document.createElement("textarea");
      el.value = link;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    toast.success(t.account_invite_copied);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const statusLabel = (status: string) => {
    if (status === "rewarded") return t.account_invite_status_rewarded;
    if (status === "skipped") return t.account_invite_status_skipped;
    return t.account_invite_status_pending;
  };

  const fmt = (n: number | null | undefined) =>
    n == null ? "—" : Number(n).toLocaleString();

  return (
    <>
      <PageHeader title={t.account_invite} subtitle={t.account_invite_sub} />

      {data?.unavailable ? (
        <div className="panel p-6 text-sm text-text-muted">{t.account_invite_unavailable}</div>
      ) : (
        <>
          <section className="panel p-5 mb-6 space-y-3">
            <div className="text-sm font-medium">{t.account_invite_link}</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                readOnly
                value={link || (data ? t.account_invite_unavailable : "...")}
                className="flex-1 px-3 py-2 rounded-lg bg-bg-elevated border border-border text-sm font-mono"
              />
              <Button type="button" onClick={() => void copyLink()} disabled={!link}>
                {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                {copied ? t.account_invite_copied : t.account_invite_copy}
              </Button>
            </div>
          </section>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard icon={Users} label={t.account_invite_stat_invited} value={fmt(data?.invitedCount ?? null)} />
            <StatCard icon={Clock} label={t.account_invite_stat_pending} value={fmt(data?.pendingCount ?? null)} />
            <StatCard
              icon={Gift}
              label={t.account_invite_stat_rewarded}
              value={fmt(data?.rewardedCount ?? null)}
              tone="success"
            />
            <StatCard
              icon={Coins}
              label={t.account_invite_stat_earned}
              value={fmt(data?.myRewardTotal ?? null)}
              tone="success"
            />
          </div>

          <section className="panel p-5 mb-6 text-sm space-y-2">
            <div className="font-medium">{t.account_invite_rules_title}</div>
            <ul className="list-disc pl-5 space-y-1 text-text-secondary">
              <li>{t.account_invite_rule_1}</li>
              <li>{t.account_invite_rule_2}</li>
              <li>{t.account_invite_rule_3}</li>
              <li>{t.account_invite_rule_4}</li>
            </ul>
          </section>

          <section className="panel overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevated/60 text-text-muted">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">{t.account_invite_col_friend}</th>
                  <th className="text-left px-4 py-3 font-medium">{t.account_invite_col_bound}</th>
                  <th className="text-left px-4 py-3 font-medium">{t.account_invite_col_status}</th>
                  <th className="text-right px-4 py-3 font-medium">{t.account_invite_col_base}</th>
                  <th className="text-right px-4 py-3 font-medium">{t.account_invite_col_reward}</th>
                </tr>
              </thead>
              <tbody>
                {!data ? (
                  <tr>
                    <td colSpan={5} className="text-center text-text-muted py-8">
                      {t.account_invite_loading}
                    </td>
                  </tr>
                ) : data.invitees.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-text-muted py-8">
                      {t.account_invite_empty}
                    </td>
                  </tr>
                ) : (
                  data.invitees.map((row, idx) => (
                    <tr key={`${row.boundAt}-${idx}`} className="border-t border-border">
                      <td className="px-4 py-3 font-mono">{row.emailMasked}</td>
                      <td className="px-4 py-3 text-text-muted whitespace-nowrap">
                        {row.boundAt
                          ? new Date(row.boundAt).toLocaleString(locale, {
                              year: "numeric",
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td className="px-4 py-3">{statusLabel(row.rewardStatus)}</td>
                      <td className="px-4 py-3 text-right font-mono">{fmt(row.sourceAmount)}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {row.rewardAmount == null ? "—" : `+${fmt(row.rewardAmount)}`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}
