import { useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Coins,
  ArrowRightLeft,
  ArrowDownToLine,
  ArrowUpFromLine,
  RotateCcw,
  Send,
  Download,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { getCreditTransactions, getTransferRecords, getTeamBalance } from '@/lib/teamCredits.functions'
import { useLanguage } from '@/i18n/LanguageContext'
import type { TransactionRow, TransferRow } from '@/lib/teamCredits.functions'

const PAGE_SIZE = 20

const TYPE_CONFIG: Record<string, { labelKey: string; icon: typeof ArrowDownToLine; color: string }> = {
  allocate: { labelKey: 'team_tx_allocate', icon: ArrowDownToLine, color: 'text-green-500' },
  reclaim: { labelKey: 'team_tx_reclaim', icon: ArrowUpFromLine, color: 'text-orange-500' },
  transfer_in: { labelKey: 'team_tx_transfer_in', icon: Download, color: 'text-green-500' },
  transfer_out: { labelKey: 'team_tx_transfer_out', icon: Send, color: 'text-orange-500' },
  consume: { labelKey: 'team_tx_consume', icon: Coins, color: 'text-blue-500' },
  refund: { labelKey: 'team_tx_refund', icon: RotateCcw, color: 'text-purple-500' },
}

type CreditsHistoryTabProps = {
  teamId: string
  myRole: string
}

export default function CreditsHistoryTab({ teamId, myRole }: CreditsHistoryTabProps) {
  const { t } = useLanguage()
  const callTransactions = useServerFn(getCreditTransactions)
  const callTransfers = useServerFn(getTransferRecords)
  const callBalance = useServerFn(getTeamBalance)

  const [transactions, setTransactions] = useState<TransactionRow[]>([])
  const [transfers, setTransfers] = useState<TransferRow[]>([])
  const [teamCredits, setTeamCredits] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      callTransactions({ data: { teamId, limit: PAGE_SIZE, offset: page * PAGE_SIZE } }),
      callTransfers({ data: { teamId } }),
      callBalance({ data: { teamId } }),
    ])
      .then(([tR, trR, bR]: any[]) => {
        if (tR?.transactions) setTransactions(tR.transactions)
        if (trR?.records) setTransfers(trR.records)
        if (bR?.balance) setTeamCredits(bR.balance.totalCredits)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [teamId, page])

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const canTransfer = myRole === 'owner' || myRole === 'admin'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 团队剩余积分 */}
      <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border">
        <div className="flex items-center gap-3">
          <Coins className="w-6 h-6 text-amber-500" />
          <div>
            <p className="text-sm text-muted-foreground">{t.team_remaining_credits}</p>
            <p className="text-2xl font-bold text-amber-500">
              {teamCredits.toLocaleString()}
            </p>
          </div>
        </div>
        {canTransfer && (
          <Button variant="outline" size="sm">
            <ArrowRightLeft className="w-4 h-4 mr-2" />
            {t.team_transfer_in}
          </Button>
        )}
      </div>

      {/* 积分记录 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t.team_credit_records}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.common_time}</TableHead>
                <TableHead>{t.team_col_description}</TableHead>
                <TableHead className="text-right">{t.team_credit_change}</TableHead>
                <TableHead className="text-right">{t.team_balance_after}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    {t.team_no_transactions}
                  </TableCell>
                </TableRow>
              ) : (
                transactions.map((tx) => {
                  const config = TYPE_CONFIG[tx.type] ?? TYPE_CONFIG.consume
                  const Icon = config.icon
                  const isPositive = tx.amount > 0
                  return (
                    <TableRow key={tx.id}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatTime(tx.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                          <span className="text-sm">{tx.description ?? t[config.labelKey as keyof typeof t]}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`text-sm font-medium ${isPositive ? 'text-green-500' : 'text-orange-500'}`}>
                          {isPositive ? '+' : ''}{tx.amount.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {tx.balanceAfter != null ? tx.balanceAfter.toLocaleString() : '-'}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>

          {/* 分页 */}
          {transactions.length >= PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                {t.team_prev_page}
              </Button>
              <span className="text-sm text-muted-foreground">{t.team_page_n(page + 1)}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
              >
                {t.team_next_page}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 转账记录 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t.team_transfer_records}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.common_time}</TableHead>
                <TableHead>{t.team_transfer_path}</TableHead>
                <TableHead className="text-right">{t.team_transfer_amount}</TableHead>
                <TableHead className="text-right">{t.team_balance_after}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    {t.team_no_transfers}
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
                        <span className="text-muted-foreground">A</span> →{' '}
                        <span className="text-primary">B</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm font-medium text-green-500">
                        +{tr.amount.toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {tr.toBalanceAfter != null ? tr.toBalanceAfter.toLocaleString() : '-'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
