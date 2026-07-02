import { useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Coins, User } from 'lucide-react'
import { allocateCredits, reclaimCredits, getTeamBalance } from '@/lib/teamCredits.functions'
import { useLanguage } from '@/i18n/LanguageContext'
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
  mode,
  onClose,
  onSuccess,
}: CreditManageDialogProps) {
  const { t } = useLanguage()
  const callAllocate = useServerFn(allocateCredits)
  const callReclaim = useServerFn(reclaimCredits)
  const callBalance = useServerFn(getTeamBalance)

  const [teamCredits, setTeamCredits] = useState(0)
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && teamId) {
      callBalance({ data: { teamId } }).then((r: any) => {
        if (r?.balance) setTeamCredits(r.balance.totalCredits)
      }).catch(() => {})
    }
  }, [open, teamId, callBalance])

  useEffect(() => {
    setAmount('')
    setError(null)
  }, [mode, open])

  if (!member) return null

  const numAmount = parseInt(amount, 10)
  const memberCredits = member.creditsBalance ?? 0

  const maxAmount = mode === 'allocate'
    ? teamCredits
    : memberCredits

  const isValid = numAmount > 0 && numAmount <= maxAmount

  const handleConfirm = async () => {
    if (!isValid) return
    setLoading(true)
    setError(null)

    const fn = mode === 'allocate' ? callAllocate : callReclaim
    const r: any = await fn({ data: { teamId, memberId: member.id, amount: numAmount } })

    setLoading(false)
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
          <DialogTitle>
            {mode === 'allocate' ? t.team_dialog_title_allocate : t.team_dialog_title_reclaim}
          </DialogTitle>
          <DialogDescription>
            <div className="flex items-center gap-2 mt-2">
              <Coins className="w-4 h-4 text-amber-500" />
              <span className="text-sm">
                {t.team_remaining_credits}：<strong>{teamCredits.toLocaleString()}</strong>
              </span>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 目标成员信息 */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
            <Avatar className="w-10 h-10">
              <AvatarImage src={member.avatarUrl ?? undefined} />
              <AvatarFallback><User className="w-4 h-4" /></AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium text-sm">{member.nickname ?? member.email}</p>
              <p className="text-xs text-muted-foreground">
                {t.team_current_credits}：{memberCredits.toLocaleString()} {t.team_credits_unit}
              </p>
            </div>
          </div>

          {/* 输入数量 */}
          <div className="space-y-2">
            <Label>
              {mode === 'allocate' ? t.team_amount_allocate : t.team_amount_reclaim}
            </Label>
            <Input
              type="number"
              min={1}
              max={maxAmount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`1 - ${maxAmount.toLocaleString()}`}
            />
            <p className="text-xs text-muted-foreground">
              {mode === 'allocate' ? t.team_amount_max : t.team_reclaim_max}（{maxAmount.toLocaleString()} {t.team_credits_unit}）
            </p>
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.common_cancel}</Button>
          <Button onClick={handleConfirm} disabled={!isValid || loading}>
            {loading ? '...' : mode === 'allocate' ? t.team_confirm_allocate : t.team_confirm_reclaim}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
