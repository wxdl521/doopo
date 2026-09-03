import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { Button } from "@/components/ui/button";
import { Coins, TrendingUp, TrendingDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  getUserCreditSummary,
  getUserCreditTransactions,
  type UserCreditTransactionRow,
} from "../lib/userCredits.functions";
import { useLanguage } from "../i18n/LanguageContext";

export const Route = createFileRoute("/account/rewards")({
  component: Rewards,
});

const PAGE_SIZE = 20;

function Rewards() {
  const { t, lang } = useLanguage();
  const locale = lang === "en" ? "en-US" : "zh-CN";
  const typeLabel: Record<string, string> = {
    recharge: "充值",
    consume: "消耗",
    admin_grant: "系统发放",
    admin_reclaim: "系统回收",
    team_allocate: "团队分配",
    team_reclaim: "团队回收",
    team_transfer_in: "团队转入",
    team_transfer_out: "团队转出",
    team_member_reclaim: "成员离队回收",
    signup_bonus: t.account_tx_signup_bonus,
    referral_reward: t.account_tx_referral_reward,
  };
  const callSummary = useServerFn(getUserCreditSummary);
  const callTx = useServerFn(getUserCreditTransactions);

  const [summary, setSummary] = useState<{
    balance: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
  } | null>(null);
  const [transactions, setTransactions] = useState<UserCreditTransactionRow[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    callSummary({ data: undefined })
      .then((r: any) =>
        setSummary({
          balance: r?.balance ?? 0,
          lifetimeEarned: r?.lifetimeEarned ?? 0,
          lifetimeSpent: r?.lifetimeSpent ?? 0,
        }),
      )
      .catch(() => setSummary({ balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 }));
  }, []);

  useEffect(() => {
    setLoading(true);
    callTx({ data: { limit: PAGE_SIZE, offset: page * PAGE_SIZE } })
      .then((r: any) => setTransactions(r?.transactions ?? []))
      .catch(() => setTransactions([]))
      .finally(() => setLoading(false));
  }, [page]);

  const fmt = (n: number | null) => (n == null ? "..." : n.toLocaleString());

  return (
    <>
      <PageHeader title={t.account_rewards} subtitle={t.account_rewards_sub} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard icon={Coins} label={t.account_balance} value={fmt(summary?.balance ?? null)} />
        <StatCard
          icon={TrendingUp}
          label={t.account_lifetime_earned}
          value={fmt(summary?.lifetimeEarned ?? null)}
          tone="success"
        />
        <StatCard
          icon={TrendingDown}
          label="累计消耗"
          value={fmt(summary?.lifetimeSpent ?? null)}
        />
      </div>

      <section className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated/60 text-text-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t.common_date}</th>
              <th className="text-left px-4 py-3 font-medium">{t.account_col_source}</th>
              <th className="text-left px-4 py-3 font-medium">{t.common_type}</th>
              <th className="text-right px-4 py-3 font-medium">{t.account_col_points}</th>
              <th className="text-right px-4 py-3 font-medium">余额</th>
            </tr>
          </thead>
          <tbody>
            {loading && transactions.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-text-muted py-8">
                  加载中...
                </td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-text-muted py-8">
                  {t.acc_credits_no_records}
                </td>
              </tr>
            ) : (
              transactions.map((tx) => {
                const isPositive = tx.amount > 0;
                const fmtTime = new Date(tx.createdAt).toLocaleString(locale, {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                });
                const source = [
                  tx.description ?? tx.model ?? "-",
                  tx.resolution,
                  tx.duration ? `${tx.duration}s` : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <tr key={tx.id} className="border-t border-border">
                    <td className="px-4 py-3 text-text-muted whitespace-nowrap">{fmtTime}</td>
                    <td className="px-4 py-3">{source}</td>
                    <td className="px-4 py-3 text-text-muted">{typeLabel[tx.type] ?? tx.type}</td>
                    <td
                      className={`px-4 py-3 text-right font-mono ${isPositive ? "text-emerald-500" : "text-rose-500"}`}
                    >
                      {isPositive ? "+" : ""}
                      {Number(tx.amount).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-text-muted">
                      {tx.balanceAfter != null ? Number(tx.balanceAfter).toLocaleString() : "-"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {(page > 0 || transactions.length >= PAGE_SIZE) && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> 上一页
            </Button>
            <span className="text-sm text-text-muted">第 {page + 1} 页</span>
            <Button
              variant="outline"
              size="sm"
              disabled={transactions.length < PAGE_SIZE}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页 <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
