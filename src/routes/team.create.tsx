import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Plus } from 'lucide-react'
import { createTeam } from '@/lib/teams.functions'

export const Route = createFileRoute('/team/create')({
  head: () => ({ meta: [{ title: 'Doopoo — 创建团队' }] }),
  component: CreateTeamPage,
})

function CreateTeamPage() {
  const navigate = useNavigate()
  const callCreateTeam = useServerFn(createTeam)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim()) return
    setCreating(true)
    setError(null)

    const r: any = await callCreateTeam({
      data: { name: name.trim(), description: description.trim() || undefined },
    })

    setCreating(false)

    if (r?.team) {
      navigate({ to: '/team' })
    } else {
      setError(r?.error ?? '创建失败，请重试')
    }
  }

  return (
    <div className="max-w-lg mx-auto py-12 px-4">
      <button
        onClick={() => navigate({ to: '/team' })}
        className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary mb-6 transition"
      >
        <ArrowLeft size={16} />
        返回
      </button>

      <Card>
        <CardHeader>
          <CardTitle>创建团队</CardTitle>
          <CardDescription>创建一个新团队，邀请成员一起协作创作。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="team-name">团队名称</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入团队名称"
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="team-desc">团队描述（选填）</Label>
            <Textarea
              id="team-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简单描述团队的目的"
              maxLength={500}
              rows={3}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</p>
          )}

          <Button
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            className="w-full"
          >
            <Plus className="w-4 h-4 mr-2" />
            {creating ? '创建中...' : '创建团队'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
