import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { Users, History, Settings, Crown, UserCog, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import MembersTab from '@/components/team/MembersTab'
import CreditsHistoryTab from '@/components/team/CreditsHistoryTab'
import SettingsTab from '@/components/team/SettingsTab'
import CreditManageDialog from '@/components/team/CreditManageDialog'
import { getTeamDetail } from '@/lib/teams.functions'
import type { MemberRow } from '@/lib/teamMembers.functions'

export const Route = createFileRoute('/team/$teamId/manage')({
  head: () => ({
    meta: [{ title: 'Doopoo — 团队管理' }],
  }),
  component: TeamManagePage,
})

type TeamDetail = {
  id: string
  name: string
  description: string | null
  ownerId: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

const ROLE_CONFIG: Record<string, { label: string; icon: typeof Crown }> = {
  owner: { label: '所有者', icon: Crown },
  admin: { label: '管理员', icon: UserCog },
  member: { label: '成员', icon: User },
}

const TABS = [
  { id: 'members', label: '成员管理', icon: Users },
  { id: 'history', label: '积分记录', icon: History },
  { id: 'settings', label: '设置', icon: Settings, ownerOnly: true },
] as const

function TeamManagePage() {
  const { teamId } = Route.useParams()
  const callGetTeamDetail = useServerFn(getTeamDetail)

  const [team, setTeam] = useState<TeamDetail | null>(null)
  const [myRole, setMyRole] = useState<string>('member')
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<string>('members')
  const [creditTarget, setCreditTarget] = useState<{ member: MemberRow; mode: 'allocate' | 'reclaim' } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    callGetTeamDetail({ data: { teamId } })
      .then((r: any) => {
        if (r?.team) {
          setTeam(r.team)
          setMyRole(r.myRole ?? 'member')
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [teamId, callGetTeamDetail])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (!team) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <h2 className="text-xl font-semibold">团队不存在</h2>
        <p className="text-muted-foreground">该团队可能已被删除或您无权访问</p>
      </div>
    )
  }

  const roleInfo = ROLE_CONFIG[myRole] ?? ROLE_CONFIG.member
  const RoleIcon = roleInfo.icon
  const visibleTabs = TABS.filter((t) => !t.ownerOnly || myRole === 'owner')

  return (
    <div className="flex gap-6 min-h-[60vh]">
      {/* 左侧边栏 */}
      <aside className="w-56 shrink-0">
        <div className="panel p-4 space-y-4">
          {/* 团队信息 */}
          <div>
            <h2 className="text-lg font-bold truncate">{team.name}</h2>
            <Badge variant="outline" className="flex items-center gap-1.5 mt-1.5 w-fit">
              <RoleIcon className="w-3.5 h-3.5" />
              {roleInfo.label}
            </Badge>
          </div>

          {/* Tab 导航 */}
          <nav className="flex flex-col gap-1">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition ${
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

      {/* 积分管理弹窗 */}
      <CreditManageDialog
        open={!!creditTarget}
        teamId={teamId}
        member={creditTarget?.member ?? null}
        mode={creditTarget?.mode ?? 'allocate'}
        onClose={() => setCreditTarget(null)}
        onSuccess={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  )
}
