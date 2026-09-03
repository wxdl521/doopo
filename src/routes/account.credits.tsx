import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { Coins, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import {
  getUserBalance,
  getUserCreditTransactions,
  rechargeCredits,
} from "../lib/userCredits.functions";
import { useLanguage } from "../i18n/LanguageContext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/account/credits")({
  component: AccountCredits,
});

// 1元 = 20积分
const PACKAGES = [
  { amount: 200, price: 10, popular: false },
  { amount: 1000, price: 50, popular: true },
  { amount: 3000, price: 150, popular: false },
];

const PAGE_SIZE = 20;

function AccountCredits() {
  const { t } = useLanguage();
  const callGetBalance = useServerFn(getUserBalance);
  const callTransactions = useServerFn(getUserCreditTransactions);
  const callRecharge = useServerFn(rechargeCredits);

  const [balance, setBalance] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [recharging, setRecharging] = useState<number | "custom" | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  // 项目名筛选：输入后 400ms 防抖生效，回到第一页
  const [projectFilterInput, setProjectFilterInput] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  useEffect(() => {
    callGetBalance({ data: undefined })
      .then((r: any) => setBalance(r?.balance ?? 0))
      .catch(() => setBalance(0));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setProjectFilter(projectFilterInput.trim());
      setPage(0);
    }, 400);
    return () => clearTimeout(timer);
  }, [projectFilterInput]);

  useEffect(() => {
    callTransactions({
      data: {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        ...(projectFilter ? { projectName: projectFilter } : {}),
      },
    })
      .then((r: any) => setTransactions(r?.transactions ?? []))
      .catch(() => setTransactions([]));
  }, [page, projectFilter]);

  const customCredits = Number.parseInt(customAmount, 10);
  const customValid =
    Number.isInteger(customCredits) && customCredits >= 1 && customCredits <= 1_000_000;
  const customPrice = customValid ? (customCredits / 20).toFixed(2) : null;

  const refreshBalance = () =>
    callGetBalance({ data: undefined })
      .then((r: { balance?: number }) => setBalance(r?.balance ?? 0))
      .catch(() => setBalance(0));

  const handleRecharge = async (credits: number, source: number | "custom") => {
    if (!Number.isInteger(credits) || credits < 1 || credits > 1_000_000) {
      toast.error(t.acc_credits_invalid_amount);
      return;
    }
    setRecharging(source);
    try {
      const result = await callRecharge({ data: { amount: credits } });
      if (result && "ok" in result && result.ok) {
        toast.success(t.acc_credits_recharge);
        await refreshBalance();
      } else {
        toast.error(t.acc_credits_offline_hint);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.acc_credits_offline_hint);
    } finally {
      setRecharging(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* 余额卡片 */}
      <div className="panel p-6 flex items-center justify-between">
        <div>
          <p className="text-sm text-text-muted">{t.account_points_balance}</p>
          <p className="text-3xl font-bold">{balance != null ? balance.toLocaleString() : "..."}</p>
        </div>
        <div className="w-12 h-12 rounded-full bg-accent-dim flex items-center justify-center">
          <Coins className="w-6 h-6 text-accent" />
        </div>
      </div>

      {/* 充值套餐（在线支付未开通：按钮走 rechargeCredits 明确提示） */}
      <h3 className="font-display text-lg font-bold">{t.acc_credits_title}</h3>
      <p className="text-xs text-text-muted -mt-4">{t.acc_credits_rate}</p>
      <p className="text-xs text-text-muted -mt-2">{t.acc_credits_offline_hint}</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {PACKAGES.map((pkg) => (
          <div
            key={pkg.amount}
            className={`panel p-5 text-center space-y-3 relative ${
              pkg.popular ? "border-accent ring-1 ring-accent/30" : ""
            }`}
          >
            {pkg.popular && (
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-semibold bg-accent text-white">
                {t.acc_credits_popular}
              </span>
            )}
            <div className="text-2xl font-bold">{pkg.amount.toLocaleString()}</div>
            <div className="text-sm text-text-muted">{t.acc_credits_unit}</div>
            <div className="text-lg font-semibold">¥{pkg.price}</div>
            <button
              type="button"
              disabled={recharging != null}
              onClick={() => void handleRecharge(pkg.amount, pkg.amount)}
              className={`w-full py-2 rounded-lg text-sm font-semibold transition disabled:opacity-50 ${
                pkg.popular
                  ? "bg-accent text-white hover:bg-accent/90"
                  : "bg-bg-elevated text-text-primary border border-border hover:border-accent/50"
              }`}
            >
              {recharging === pkg.amount ? t.acc_credits_busy : t.acc_credits_recharge}
            </button>
          </div>
        ))}

        {/* 自定义金额 */}
        <div className="panel p-5 text-center space-y-3">
          <div className="text-sm text-text-muted">{t.acc_credits_custom}</div>
          <input
            type="number"
            min="1"
            max="1000000"
            step="1"
            placeholder={t.acc_credits_custom_placeholder}
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            className="w-full text-center text-xl font-bold bg-transparent border-b border-border focus:border-accent outline-none py-1"
          />
          <div className="text-lg font-semibold">
            {customPrice != null ? `¥${customPrice}` : "-"}
          </div>
          <button
            type="button"
            disabled={recharging != null}
            onClick={() => void handleRecharge(customCredits, "custom")}
            className="w-full py-2 rounded-lg text-sm font-semibold transition bg-bg-elevated text-text-primary border border-border hover:border-accent/50 disabled:opacity-50"
          >
            {recharging === "custom" ? t.acc_credits_busy : t.acc_credits_recharge}
          </button>
        </div>
      </div>

      {/* 消耗记录 */}
      <section className="panel p-0 overflow-hidden">
        <div className="px-6 pt-6 pb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-lg font-bold">{t.acc_credits_history}</h3>
          <input
            type="text"
            value={projectFilterInput}
            onChange={(e) => setProjectFilterInput(e.target.value)}
            placeholder={t.acc_credits_project_filter_placeholder}
            aria-label={t.acc_credits_project_filter_placeholder}
            className="w-56 text-sm bg-transparent border border-border rounded-lg px-3 py-1.5 outline-none focus:border-accent"
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.acc_credits_col_time}</TableHead>
              <TableHead>{t.acc_credits_col_project}</TableHead>
              <TableHead>{t.acc_credits_col_desc}</TableHead>
              <TableHead className="text-right">{t.acc_credits_col_amount}</TableHead>
              <TableHead className="text-right">{t.acc_credits_col_balance}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-text-muted py-8">
                  {t.acc_credits_no_records}
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((tx) => {
                const isPositive = tx.amount > 0;
                const fmtTime = new Date(tx.createdAt).toLocaleString("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <TableRow key={tx.id}>
                    <TableCell className="text-sm text-text-muted whitespace-nowrap">
                      {fmtTime}
                    </TableCell>
                    <TableCell className="text-sm text-text-muted">
                      {tx.projectName ?? "-"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {tx.description ?? tx.model ?? "-"}
                      {tx.resolution ? ` · ${tx.resolution}` : ""}
                      {tx.duration ? ` · ${tx.duration}s` : ""}
                    </TableCell>
                    <TableCell
                      className={`text-right text-sm font-medium ${isPositive ? "text-green-500" : "text-orange-500"}`}
                    >
                      {isPositive ? "+" : ""}
                      {Number(tx.amount).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-sm text-text-muted">
                      {tx.balanceAfter != null ? Number(tx.balanceAfter).toLocaleString() : "-"}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        {transactions.length >= PAGE_SIZE && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> {t.acc_credits_prev}
            </Button>
            <span className="text-sm text-text-muted">{page + 1}</span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>
              {t.acc_credits_next} <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
