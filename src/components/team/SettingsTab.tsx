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
import { AlertTriangle, Save } from 'lucide-react'
import { updateTeam, deleteTeam } from '@/lib/teams.functions'
import { useLanguage } from '@/i18n/LanguageContext'

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
  const { t } = useLanguage()
  const navigate = useNavigate()
  const callUpdateTeam = useServerFn(updateTeam)
  const callDeleteTeam = useServerFn(deleteTeam)

  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

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
      data: { teamId, name: name.trim(), description: description.trim() || undefined },
    })

    setSaving(false)
    if (r?.ok) {
      setSaved(true)
      onUpdate()
      setTimeout(() => setSaved(false), 3000)
    } else {
      setSaveError(r?.error ?? t.team_save_error)
    }
  }

  const handleDissolve = async () => {
    setDissolving(true)
    setDissolveError(null)

    const r: any = await callDeleteTeam({ data: { teamId } })

    setDissolving(false)
    if (r?.ok) {
      navigate({ to: '/team' })
    } else {
      setDissolveError(r?.error ?? t.team_dissolve_error)
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
          <CardTitle className="text-base">{t.team_settings_basic}</CardTitle>
          <CardDescription>{t.team_settings_basic_desc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="team-name">{t.team_name}</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => { setName(e.target.value); setSaved(false) }}
              placeholder={t.team_name_placeholder}
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="team-desc">{t.team_description}</Label>
            <Textarea
              id="team-desc"
              value={description}
              onChange={(e) => { setDescription(e.target.value); setSaved(false) }}
              placeholder={t.team_desc_placeholder}
              maxLength={500}
              rows={3}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? t.team_saving : t.team_save}
            </Button>
            {saved && <span className="text-sm text-green-500">{t.team_saved}</span>}
            {saveError && <span className="text-sm text-destructive">{saveError}</span>}
          </div>
        </CardContent>
      </Card>

      {/* 危险操作 */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {t.team_danger_zone}
          </CardTitle>
          <CardDescription>{t.team_dissolve_warning}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={openDissolve}>
            {t.team_dissolve}
          </Button>
        </CardContent>
      </Card>

      {/* 解散确认弹窗 */}
      <AlertDialog
        open={showDissolve}
        onOpenChange={(open) => {
          if (!open) { setShowDissolve(false); setDissolveStep('confirm') }
        }}
      >
        <AlertDialogContent>
          {dissolveStep === 'confirm' ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-destructive">{t.team_dissolve_confirm_title}</AlertDialogTitle>
                <AlertDialogDescription>
                  <p className="mb-3">{t.team_dissolve_confirm_desc}</p>
                  <Label htmlFor="confirm-name" className="text-foreground">
                    {t.team_dissolve_input_prompt(initialName)}
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
                  {t.common_cancel}
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={confirmName !== initialName}
                  onClick={() => setDissolveStep('final')}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t.team_continue}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-destructive">{t.team_final_confirm}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t.team_dissolve_final_desc(initialName)}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {dissolveError && (
                <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">{dissolveError}</p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setDissolveStep('confirm')}>
                  {t.team_back}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDissolve}
                  disabled={dissolving}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {dissolving ? t.team_dissolving : t.team_confirm_dissolve}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
