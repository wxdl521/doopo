import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { Coins } from "lucide-react";
import { getUserBalance } from "../lib/userCredits.functions";
import { useLanguage } from "../i18n/LanguageContext";

export const Route = createFileRoute("/account/credits")({
  component: AccountCredits,
});

// 1元 = 100积分
const PACKAGES = [
  { amount: 1000, price: 10, popular: false },
  { amount: 5000, price: 50, popular: true },
  { amount: 15000, price: 128, popular: false },
];

function AccountCredits() {
  const { t } = useLanguage();
  const callGetBalance = useServerFn(getUserBalance);

  const [balance, setBalance] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");

  useEffect(() => {
    callGetBalance({ data: undefined })
      .then((r: any) => setBalance(r?.balance ?? 0))
      .catch(() => setBalance(0));
  }, []);

  const customCredits = parseInt(customAmount, 10);
  const customPrice =
    isNaN(customCredits) || customCredits <= 0 ? null : (customCredits / 100).toFixed(2);

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

      {/* 充值套餐 */}
      <h3 className="font-display text-lg font-bold">充值积分</h3>
      <p className="text-xs text-text-muted -mt-4">1元 = 100积分</p>
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
                热门
              </span>
            )}
            <div className="text-2xl font-bold">{pkg.amount.toLocaleString()}</div>
            <div className="text-sm text-text-muted">积分</div>
            <div className="text-lg font-semibold">¥{pkg.price}</div>
            <button
              className={`w-full py-2 rounded-lg text-sm font-semibold transition ${
                pkg.popular
                  ? "bg-accent text-white hover:bg-accent/90"
                  : "bg-bg-elevated text-text-primary border border-border hover:border-accent/50"
              }`}
            >
              充值
            </button>
          </div>
        ))}

        {/* 自定义金额 */}
        <div className="panel p-5 text-center space-y-3">
          <div className="text-sm text-text-muted">自定义</div>
          <input
            type="number"
            min="1"
            placeholder="输入积分"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            className="w-full text-center text-xl font-bold bg-transparent border-b border-border focus:border-accent outline-none py-1"
          />
          <div className="text-lg font-semibold">
            {customPrice != null ? `¥${customPrice}` : "-"}
          </div>
          <button className="w-full py-2 rounded-lg text-sm font-semibold transition bg-bg-elevated text-text-primary border border-border hover:border-accent/50">
            充值
          </button>
        </div>
      </div>
    </div>
  );
}
