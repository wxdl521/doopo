import { createFileRoute } from "@tanstack/react-router";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { Coins, Award, TrendingUp } from "lucide-react";
import { mockRewards, type RewardEntry } from "../data/mock";
import { useLanguage } from "../i18n/LanguageContext";

export const Route = createFileRoute("/account/rewards")({
  component: Rewards,
});

const tone: Record<RewardEntry["type"], string> = {
  earn: "text-emerald-500",
  spend: "text-rose-500",
  cashout: "text-amber-500",
};

function Rewards() {
  const { t } = useLanguage();
  const balance = mockRewards.reduce((s, r) => s + r.points, 0);
  const earned = mockRewards.filter((r) => r.type === "earn").reduce((s, r) => s + r.points, 0);
  const typeLabel: Record<RewardEntry["type"], string> = {
    earn: t.account_reward_earn,
    spend: t.account_reward_spend,
    cashout: t.account_reward_cashout,
  };
  return (
    <>
      <PageHeader title={t.account_rewards} subtitle={t.account_rewards_sub} />
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard icon={Coins} label={t.account_balance} value={balance} />
        <StatCard
          icon={TrendingUp}
          label={t.account_lifetime_earned}
          value={earned}
          tone="success"
        />
        <StatCard
          icon={Award}
          label={t.account_tier}
          value={t.account_tier_value}
          hint={t.account_tier_top}
        />
      </div>

      <section className="panel p-6 mb-6">
        <h3 className="font-display font-bold mb-3">{t.account_tier_progress}</h3>
        <div className="text-xs text-text-muted mb-2 flex justify-between">
          <span>{t.account_tier_l4}</span>
          <span>{t.account_tier_l5_to_go}</span>
        </div>
        <div className="h-3 bg-bg-elevated rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-accent to-accent-soft"
            style={{ width: "64%" }}
          />
        </div>
      </section>

      <section className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated/60 text-text-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{t.common_date}</th>
              <th className="text-left px-4 py-3 font-medium">{t.account_col_source}</th>
              <th className="text-left px-4 py-3 font-medium">{t.common_type}</th>
              <th className="text-right px-4 py-3 font-medium">{t.account_col_points}</th>
            </tr>
          </thead>
          <tbody>
            {mockRewards.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-4 py-3 text-text-muted">{r.ts}</td>
                <td className="px-4 py-3">{r.source}</td>
                <td className={`px-4 py-3 ${tone[r.type]}`}>{typeLabel[r.type]}</td>
                <td
                  className={`px-4 py-3 text-right font-mono ${r.points >= 0 ? "text-emerald-500" : "text-rose-500"}`}
                >
                  {r.points >= 0 ? `+${r.points}` : r.points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
