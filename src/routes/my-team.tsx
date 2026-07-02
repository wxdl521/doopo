import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
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
import {
  Users,
  Shield,
  Settings,
  LogOut,
  Crown,
  UserCog,
  User,
  Plus,
  ArrowRight,
} from 'lucide-react'
import { getMyTeams } from '@/lib/teams.functions'
import { leaveTeam } from '@/lib/teamMembers.functions'
import { useAuth } from '@/hooks/useAuth'

export const Route = createFileRoute('/my-team')({
  head: () => ({
    meta: [{ title: 'Doopoo — 我的团队' }],
  }),
  component: MyTeamPage,
})

// 团队规则
const TEAM_RULES = [
  {
    icon: Users,
    title: '协作创作',
    description: '团队成员可以共享项目、角色和素材，实现高效协作。',
  },
  {
    icon: Shield,
    title: '积分池管理',
    description: '团队积分由所有者统一管理，可按需分配给成员使用。',
  },
  {
    icon: Settings,
    title: '灵活权限',
    description: '支持所有者、管理员和成员三种角色，精细控制操作权限。',
  },
]

const ROLE_CONFIG: Record<string, { label: string; icon: typeof Crown; color: 'default' | 'secondary' | 'outline' }> = {
  owner: { label: '所有者', icon: Crown, color: 'default' },
  admin: { label: '管理员', icon: UserCog, color: 'secondary' },
  member: { label: '成员', icon: User, color: 'outline' },
}

function MyTeamPage() {
  const navigate = useNavigate()
  const { isAuthenticated, loading: authLoading } = useAuth()
  const callGetMyTeams = useServerFn(getMyTeams)
  const callLeaveTeam = useServerFn(leaveTeam)

  const [teams, setTeams] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated) {
      setLoading(false)
      return
    }
    callGetMyTeams({ data: {} })
      .then((r: any) => {
        if (r?.teams) setTeams(r.teams)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [isAuthenticated, authLoading, callGetMyTeams])

  const handleLeave = async () => {
    if (!leaveTarget) return
    const r: any = await callLeaveTeam({ data: { teamId: leaveTarget } })
    if (r?.ok) {
      setTeams((prev) => prev.filter((t) => t.id !== leaveTarget))
    }
    setLeaveTarget(null)
  }

  // 未登录
  if (!authLoading && !isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Users className="w-16 h-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">请先登录</h2>
        <p className="text-muted-foreground">登录后查看您的团队</p>
      </div>
    )
  }

  // 加载中
  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  // 无团队
  if (teams.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 space-y-8">
        {/* 团队规则 */}
        <div>
          <h2 className="text-2xl font-bold mb-6">团队规则</h2>
          <div className="grid gap-4">
            {TEAM_RULES.map((rule) => (
              <Card key={rule.title}>
                <CardContent className="flex items-start gap-4 pt-6">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <rule.icon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{rule.title}</h3>
                    <p className="text-sm text-muted-foreground">{rule.description}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* 空状态 */}
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Users className="w-12 h-12 text-muted-foreground" />
            <div className="text-center">
              <h3 className="font-semibold text-lg mb-1">尚未加入任何团队</h3>
              <p className="text-sm text-muted-foreground">创建一个团队或接受邀请，开始协作创作。</p>
            </div>
            <Button onClick={() => navigate({ to: '/team/create' })}>
              <Plus className="w-4 h-4 mr-2" />
              创建团队
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // 有团队 — 显示第一个团队（V1 单团队）
  const team = teams[0]
  const roleInfo = ROLE_CONFIG[team.role] ?? ROLE_CONFIG.member
  const RoleIcon = roleInfo.icon
  const isOwnerOrAdmin = team.role === 'owner' || team.role === 'admin'
  const isOwner = team.role === 'owner'

  return (
    <div className="max-w-2xl mx-auto py-12 px-4 space-y-8">
      {/* 团队规则 */}
      <div>
        <h2 className="text-2xl font-bold mb-6">团队规则</h2>
        <div className="grid gap-4">
          {TEAM_RULES.map((rule) => (
            <Card key={rule.title}>
              <CardContent className="flex items-start gap-4 pt-6">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <rule.icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{rule.title}</h3>
                  <p className="text-sm text-muted-foreground">{rule.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* 团队卡片 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">{team.name}</CardTitle>
              {team.description && (
                <CardDescription className="mt-1">{team.description}</CardDescription>
              )}
            </div>
            <Badge variant={roleInfo.color} className="flex items-center gap-1.5">
              <RoleIcon className="w-3.5 h-3.5" />
              {roleInfo.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6 text-sm text-muted-foreground mb-4">
            <span>创建时间：{new Date(team.createdAt).toLocaleDateString('zh-CN')}</span>
            {team.creditsBalance !== undefined && (
              <span>可用积分：{team.creditsBalance}</span>
            )}
          </div>

          <Separator className="my-4" />

          <div className="flex items-center gap-3">
            {isOwnerOrAdmin && (
              <Button onClick={() => navigate({ to: '/team/$teamId/manage', params: { teamId: team.id } })}>
                <Settings className="w-4 h-4 mr-2" />
                管理团队
              </Button>
            )}

            {!isOwner && (
              <Button variant="outline" onClick={() => setLeaveTarget(team.id)}>
                <LogOut className="w-4 h-4 mr-2" />
                离开团队
              </Button>
            )}

            {isOwner && (
              <p className="text-xs text-muted-foreground">
                作为所有者，您不能离开自己的团队。如需退出，请先转让所有权或解散团队。
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 离开确认弹窗 */}
      <AlertDialog open={!!leaveTarget} onOpenChange={(open) => !open && setLeaveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认离开团队</AlertDialogTitle>
            <AlertDialogDescription>
              离开团队后，您将失去对团队项目的访问权限。
              您的未消耗积分将被退回团队池。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleLeave} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              确认离开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
