import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { Card, CardContent } from '@/components/ui/card'
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
  History,
  Settings,
  LogOut,
  Crown,
  UserCog,
  User,
  Plus,
} from 'lucide-react'
import MembersTab from '@/components/team/MembersTab'
import CreditsHistoryTab from '@/components/team/CreditsHistoryTab'
import SettingsTab from '@/components/team/SettingsTab'
import CreditManageDialog from '@/components/team/CreditManageDialog'
import { getMyTeams, getTeamDetail } from '@/lib/teams.functions'
import { leaveTeam } from '@/lib/teamMembers.functions'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/i18n/LanguageContext'
import type { MemberRow } from '@/lib/teamMembers.functions'

export const Route = createFileRoute('/team/')({
  head: () => ({ meta: [{ title: 'Doopoo — 团队' }] }),
  component: TeamPage,
})

const ROLE_CONFIG: Record<string, { label: string; icon: typeof Crown }> = {
  owner: { label: '所有者', icon: Crown },
  admin: { label: '管理员', icon: UserCog },
  member: { label: '成员', icon: User },
}

const ROLE_BADGE_COLOR: Record<string, 'default' | 'secondary' | 'outline'> = {
  owner: 'default',
  admin: 'secondary',
  member: 'outline',
}

const TABS = [
  { id: 'members', label: '成员管理', icon: Users },
  { id: 'history', label: '积分记录', icon: History },
  { id: 'settings', label: '设置', icon: Settings, ownerOnly: true },
] as const

type TeamDetail = {
  id: string
  name: string
  description: string | null
  ownerId: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

function TeamPage() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { isAuthenticated, loading: authLoading } = useAuth()
  const callGetMyTeams = useServerFn(getMyTeams)
  const callGetTeamDetail = useServerFn(getTeamDetail)
  const callLeaveTeam = useServerFn(leaveTeam)

  const [teams, setTeams] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [team, setTeam] = useState<TeamDetail | null>(null)
  const [myRole, setMyRole] = useState<string>('member')
  const [activeTab, setActiveTab] = useState<string>('members')
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null)
  const [creditTarget, setCreditTarget] = useState<{ member: MemberRow; mode: 'allocate' | 'reclaim' } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (authLoading) return
    if (!isAuthenticated) { setLoading(false); return }
    callGetMyTeams({ data: {} })
      .then((r: any) => {
        if (r?.teams) setTeams(r.teams)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [isAuthenticated, authLoading, callGetMyTeams])

  useEffect(() => {
    if (teams.length === 0) return
    const teamId = teams[0].id
    callGetTeamDetail({ data: { teamId } })
      .then((r: any) => {
        if (r?.team) {
          setTeam(r.team)
          setMyRole(r.myRole ?? 'member')
        }
      })
      .catch(() => {})
  }, [teams, callGetTeamDetail])

  const handleLeave = async () => {
    if (!leaveTarget) return
    const r: any = await callLeaveTeam({ data: { teamId: leaveTarget } })
    if (r?.ok) {
      setTeams([])
      setTeam(null)
    }
    setLeaveTarget(null)
  }

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Users className="w-16 h-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">{t.team_login_first}</h2>
        <p className="text-muted-foreground">{t.team_login_desc}</p>
      </div>
    )
  }

  if (teams.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Users className="w-12 h-12 text-muted-foreground" />
            <div className="text-center">
              <h3 className="font-semibold text-lg mb-1">{t.team_no_team}</h3>
              <p className="text-sm text-muted-foreground">{t.team_no_team_desc}</p>
            </div>
            <Button onClick={() => navigate({ to: '/team/create' })}>
              <Plus className="w-4 h-4 mr-2" />{t.team_create_btn}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!team) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  const roleInfo = ROLE_CONFIG[myRole] ?? ROLE_CONFIG.member
  const RoleIcon = roleInfo.icon
  const visibleTabs = TABS.filter((tab) => !tab.ownerOnly || myRole === 'owner')
  const teamId = team.id
  const isOwner = myRole === 'owner'

  return (
    <div className="animate-fade-in flex flex-col md:flex-row gap-6">
      {/* 左侧边栏 */}
      <aside className="md:w-56 md:shrink-0">
        <div className="panel p-3">
          <div className="px-3 py-2 mb-2">
            <h2 className="text-sm font-bold text-text-primary truncate">{team.name}</h2>
            <Badge variant={ROLE_BADGE_COLOR[myRole] ?? 'outline'} className="flex items-center gap-1.5 mt-1.5 w-fit">
              <RoleIcon className="w-3 h-3" />
              <span className="text-xs">{roleInfo.label}</span>
            </Badge>
          </div>

          <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition ${
                    isActive
                      ? 'bg-accent-dim text-accent font-semibold'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                  }`}
                >
                  <Icon size={15} />
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </nav>

          <Separator className="my-3" />

          {!isOwner && (
            <button
              onClick={() => setLeaveTarget(teamId)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-text-muted hover:text-destructive hover:bg-destructive/10 transition w-full"
            >
              <LogOut size={15} />
              <span>{t.team_leave_btn}</span>
            </button>
          )}
        </div>
      </aside>

      {/* 右侧内容 */}
      <div className="flex-1 min-w-0">
        {activeTab === 'members' && (
          <MembersTab
            key={refreshKey}
            teamId={teamId}
            myRole={myRole}
            onManageCredits={(member, mode) => setCreditTarget({ member, mode })}
          />
        )}
        {activeTab === 'history' && (
          <CreditsHistoryTab teamId={teamId} myRole={myRole} />
        )}
        {activeTab === 'settings' && (
          <SettingsTab
            teamId={teamId}
            initialName={team.name}
            initialDescription={team.description ?? ''}
            onUpdate={() =>
              callGetTeamDetail({ data: { teamId } }).then((r: any) => {
                if (r?.team) {
                  setTeam(r.team)
                  setMyRole(r.myRole ?? 'member')
                }
              })
            }
          />
        )}
      </div>

      <CreditManageDialog
        open={!!creditTarget}
        teamId={teamId}
        member={creditTarget?.member ?? null}
        mode={creditTarget?.mode ?? 'allocate'}
        onClose={() => setCreditTarget(null)}
        onSuccess={() => setRefreshKey((k) => k + 1)}
      />

      <AlertDialog open={!!leaveTarget} onOpenChange={(open) => !open && setLeaveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.team_leave_title}</AlertDialogTitle>
            <AlertDialogDescription>{t.team_leave_desc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common_cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleLeave} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t.team_leave_confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
