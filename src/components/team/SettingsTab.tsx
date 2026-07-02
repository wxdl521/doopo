import { useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Separator } from '@/components/ui/separator'
import { AlertTriangle, Save } from 'lucide-react'
import { updateTeam, deleteTeam } from '@/lib/teams.functions'

type SettingsTabProps = {
  teamId: string
  initialName: string
  initialDescription: string
  onUpdate: () => void
}

export default function SettingsTab({
  teamId,
  initialName,
  initialDescription,
  onUpdate,
}: SettingsTabProps) {
  const navigate = useNavigate()
  const callUpdateTeam = useServerFn(updateTeam)
  const callDeleteTeam = useServerFn(deleteTeam)

  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // 解散团队
  const [showDissolve, setShowDissolve] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [dissolveStep, setDissolveStep] = useState<'confirm' | 'final'>('confirm')
  const [dissolving, setDissolving] = useState(false)
  const [dissolveError, setDissolveError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    setSaveError(null)
    setSaved(false)

    const r: any = await callUpdateTeam({
      data: {
        teamId,
        name: name.trim(),
        description: description.trim() || undefined,
      },
    })

    setSaving(false)
    if (r?.ok) {
      setSaved(true)
      onUpdate()
      setTimeout(() => setSaved(false), 3000)
    } else {
      setSaveError(r?.error ?? '保存失败')
    }
  }

  const handleDissolve = async () => {
    setDissolving(true)
    setDissolveError(null)

    const r: any = await callDeleteTeam({ data: { teamId } })

    setDissolving(false)
    if (r?.ok) {
      navigate({ to: '/my-team' })
    } else {
      setDissolveError(r?.error ?? '解散失败')
    }
  }

  const openDissolve = () => {
    setShowDissolve(true)
    setDissolveStep('confirm')
    setConfirmName('')
    setDissolveError(null)
  }

  return (
    <div className="space-y-6">
      {/* 基本信息 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">基本信息</CardTitle>
          <CardDescription>编辑团队名称和描述</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="team-name">团队名称</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => { setName(e.target.value); setSaved(false) }}
              placeholder="输入团队名称"
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="team-desc">团队描述</Label>
            <Textarea
              id="team-desc"
              value={description}
              onChange={(e) => { setDescription(e.target.value); setSaved(false) }}
              placeholder="输入团队描述（选填）"
              maxLength={500}
              rows={3}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? '保存中...' : '保存更改'}
            </Button>
            {saved && (
              <span className="text-sm text-green-500">已保存</span>
            )}
            {saveError && (
              <span className="text-sm text-destructive">{saveError}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 危险操作 */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            危险操作
          </CardTitle>
          <CardDescription>
            删除此团队。删除团队后，积分将换算成金额返还到您的个人账户。此操作不可撤销。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={openDissolve}>
            解散团队
          </Button>
        </CardContent>
      </Card>

      {/* 解散确认弹窗 */}
      <AlertDialog
        open={showDissolve}
        onOpenChange={(open) => {
          if (!open) {
            setShowDissolve(false)
            setDissolveStep('confirm')
          }
        }}
      >
        <AlertDialogContent>
          {dissolveStep === 'confirm' ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-destructive">确认解散团队</AlertDialogTitle>
                <AlertDialogDescription>
                  <p className="mb-3">
                    解散团队后，所有成员的积分将按汇率折算成金额返还到您的个人账户。
                    此操作不可撤销。
                  </p>
                  <Label htmlFor="confirm-name" className="text-foreground">
                    请输入团队名称 <strong>{initialName}</strong> 以确认：
                  </Label>
                  <Input
                    id="confirm-name"
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    placeholder={initialName}
                    className="mt-1.5"
                  />
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setShowDissolve(false)}>
                  取消
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={confirmName !== initialName}
                  onClick={() => setDissolveStep('final')}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  继续
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-destructive">最终确认</AlertDialogTitle>
                <AlertDialogDescription>
                  您确定要解散 <strong>{initialName}</strong> 吗？
                  所有成员的积分将退还到您的账户，此操作无法撤销。
                </AlertDialogDescription>
              </AlertDialogHeader>
              {dissolveError && (
                <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">
                  {dissolveError}
                </p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setDissolveStep('confirm')}>
                  返回
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDissolve}
                  disabled={dissolving}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {dissolving ? '解散中...' : '确认解散'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
