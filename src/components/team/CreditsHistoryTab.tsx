import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Coins,
  ArrowDownToLine,
  ArrowUpFromLine,
  RotateCcw,
  Send,
  Download,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  getCreditTransactions,
  getTransferRecords,
  getTeamBalance,
} from "@/lib/teamCredits.functions";
import { useLanguage } from "@/i18n/LanguageContext";
import type { TransactionRow, TransferRow } from "@/lib/teamCredits.functions";

const PAGE_SIZE = 20;

const TYPE_CONFIG: Record<
  string,
  { labelKey: string; icon: typeof ArrowDownToLine; color: string }
> = {
  allocate: { labelKey: "history_type_allocate", icon: ArrowDownToLine, color: "text-green-500" },
  reclaim: { labelKey: "history_type_reclaim", icon: ArrowUpFromLine, color: "text-orange-500" },
  transfer_in: { labelKey: "history_type_transfer_in", icon: Download, color: "text-green-500" },
  transfer_out: { labelKey: "history_type_transfer_out", icon: Send, color: "text-orange-500" },
  consume: { labelKey: "history_type_consume", icon: Coins, color: "text-blue-500" },
  refund: { labelKey: "history_type_refund", icon: RotateCcw, color: "text-purple-500" },
};

type CreditsHistoryTabProps = {
  teamId: string;
};

export default function CreditsHistoryTab({ teamId }: CreditsHistoryTabProps) {
  const { t } = useLanguage();
  const callTransactions = useServerFn(getCreditTransactions);
  const callTransfers = useServerFn(getTransferRecords);
  const callBalance = useServerFn(getTeamBalance);

  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [teamCredits, setTeamCredits] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      callTransactions({ data: { teamId, limit: PAGE_SIZE, offset: page * PAGE_SIZE } }),
      callTransfers({ data: { teamId } }),
      callBalance({ data: { teamId } }),
    ])
      .then(([tR, trR, bR]: any[]) => {
        if (tR?.transactions) setTransactions(tR.transactions);
        if (trR?.records) setTransfers(trR.records);
        if (bR?.balance) setTeamCredits(bR.balance.totalCredits);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [teamId, page]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 团队剩余积分 */}
      <section className="panel flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Coins className="w-6 h-6 text-amber-500" />
          <div>
            <p className="text-sm text-muted-foreground">{t.history_team_credits}</p>
            <p className="text-2xl font-bold text-amber-500">{teamCredits.toLocaleString()}</p>
          </div>
        </div>
      </section>

      {/* 积分记录 */}
      <section className="panel p-0 overflow-hidden">
        <div className="px-6 pt-6 pb-3">
          <h3 className="font-display text-lg font-bold">{t.history_credit_records}</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.common_time}</TableHead>
              <TableHead>{t.history_col_desc}</TableHead>
              <TableHead className="text-right">{t.history_col_change}</TableHead>
              <TableHead className="text-right">{t.history_col_balance}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  {t.history_no_records}
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((tx) => {
                const config = TYPE_CONFIG[tx.type] ?? TYPE_CONFIG.consume;
                const Icon = config.icon;
                const isPositive = tx.amount > 0;
                return (
                  <TableRow key={tx.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatTime(tx.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                        <span className="text-sm">
                          {tx.description ?? t[config.labelKey as keyof typeof t]}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={`text-sm font-medium ${isPositive ? "text-green-500" : "text-orange-500"}`}
                      >
                        {isPositive ? "+" : ""}
                        {tx.amount.toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {tx.balanceAfter != null ? tx.balanceAfter.toLocaleString() : "-"}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {transactions.length >= PAGE_SIZE && (
          <div className="flex items-center justify-between px-6 py-3 border-t">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              {t.history_prev_page}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t.history_page.replace("{page}", String(page + 1))}
            </span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>
              {t.history_next_page}
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </section>

      {/* 转账记录 */}
      <section className="panel p-0 overflow-hidden">
        <div className="px-6 pt-6 pb-3">
          <h3 className="font-display text-lg font-bold">{t.history_transfer_records}</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.common_time}</TableHead>
              <TableHead>{t.history_col_path}</TableHead>
              <TableHead className="text-right">{t.history_col_amount}</TableHead>
              <TableHead className="text-right">{t.history_col_balance}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transfers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  {t.history_no_transfers}
                </TableCell>
              </TableRow>
            ) : (
              transfers.map((tr) => (
                <TableRow key={tr.id}>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatTime(tr.createdAt)}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">
                      <span className="text-muted-foreground">A</span> →{" "}
                      <span className="text-primary">B</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm font-medium text-green-500">
                      +{tr.amount.toLocaleString()}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {tr.toBalanceAfter != null ? tr.toBalanceAfter.toLocaleString() : "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
