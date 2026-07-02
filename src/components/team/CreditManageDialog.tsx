import { useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowRightLeft,
  Coins,
} from 'lucide-react'
import { allocateCredits, reclaimCredits, getTeamBalance } from '@/lib/teamCredits.functions'
import type { MemberRow } from '@/lib/teamMembers.functions'

type CreditManageDialogProps = {
  open: boolean
  teamId: string
  member: MemberRow | null
  mode: 'allocate' | 'reclaim'
  onClose: () => void
  onSuccess: () => void
}

export default function CreditManageDialog({
  open,
  teamId,
  member,
  mode: initialMode,
  onClose,
  onSuccess,
}: CreditManageDialogProps) {
  const callAllocate = useServerFn(allocateCredits)
  const callReclaim = useServerFn(reclaimCredits)
  const callBalance = useServerFn(getTeamBalance)

  const [mode, setMode] = useState<'allocate' | 'reclaim'>(initialMode)
  const [amount, setAmount] = useState('')
  const [teamCredits, setTeamCredits] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setMode(initialMode)
      setAmount('')
      setError(null)
      // 获取团队剩余积分
      callBalance({ data: { teamId } })
        .then((r: any) => {
          if (r?.balance) setTeamCredits(r.balance.totalCredits)
        })
        .catch(() => {})
    }
  }, [open, initialMode, teamId])

  if (!member) return null

  const numAmount = parseInt(amount, 10)
  const isValidAmount = !isNaN(numAmount) && numAmount > 0

  const maxAllocate = teamCredits
  const maxReclaim = member.creditsBalance
  const maxAmount = mode === 'allocate' ? maxAllocate : maxReclaim
  const overMax = isValidAmount && numAmount > maxAmount

  const displayName = member.displayName ?? member.email ?? '未知用户'
  const initial = displayName[0].toUpperCase()

  const handleSubmit = async () => {
    if (!isValidAmount || overMax) return
    setSubmitting(true)
    setError(null)

    let r: any
    if (mode === 'allocate') {
      r = await callAllocate({
        data: {
          teamId,
          userId: member.userId,
          amount: numAmount,
          description: `为 ${displayName} 分配积分`,
        },
      })
    } else {
      r = await callReclaim({
        data: {
          teamId,
          userId: member.userId,
          amount: numAmount,
          description: `从 ${displayName} 回收积分`,
        },
      })
    }

    setSubmitting(false)
    if (r?.ok) {
      onSuccess()
      onClose()
    } else {
      setError(r?.error ?? '操作失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>管理成员积分</DialogTitle>
          <DialogDescription>
            为 {displayName} 分配或回收积分
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 团队剩余积分 */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2">
              <Coins className="w-5 h-5 text-amber-500" />
              <span className="text-sm font-medium">团队剩余积分</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-amber-500">
                {teamCredits.toLocaleString()}
              </span>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="转入积分">
                <ArrowRightLeft className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* 成员信息 */}
          <div className="flex items-center gap-3 p-3 rounded-lg border">
            <Avatar className="h-10 w-10">
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground truncate">
                {member.email ?? '-'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">可用积分</p>
              <p className="font-bold text-amber-500">{member.creditsBalance}</p>
            </div>
          </div>

          {/* 分配/回收切换 */}
          <div className="flex gap-2">
            <Button
              variant={mode === 'allocate' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => { setMode('allocate'); setAmount(''); setError(null) }}
            >
              <ArrowDownToLine className="w-4 h-4 mr-2" />
              分配
            </Button>
            <Button
              variant={mode === 'reclaim' ? 'default' : 'outline'}
              className="flex-1"
              onClick={() => { setMode('reclaim'); setAmount(''); setError(null) }}
            >
              <ArrowUpFromLine className="w-4 h-4 mr-2" />
              回收
            </Button>
          </div>

          {/* 数量输入 */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              {mode === 'allocate' ? '分配' : '回收'}积分数量
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Input
                  type="number"
                  min={1}
                  max={maxAmount}
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); setError(null) }}
                  placeholder="0"
                  className={overMax ? 'border-destructive' : ''}
                />
                {overMax && (
                  <p className="text-xs text-destructive mt-1">
                    超过可用上限（{maxAmount.toLocaleString()}）
                  </p>
                )}
              </div>
              <Button
                onClick={handleSubmit}
                disabled={!isValidAmount || overMax || submitting}
              >
                {submitting ? '处理中...' : '确认'}
              </Button>
            </div>
          </div>

          {/* 提示 */}
          <p className="text-xs text-muted-foreground">
            {mode === 'allocate'
              ? `从团队剩余积分中划出，加到该成员的可用积分。当前最多可分配 ${maxAllocate.toLocaleString()}。`
              : `从该成员可用积分中收回，返回团队积分池。当前最多可回收 ${maxReclaim.toLocaleString()}。`
            }
          </p>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
