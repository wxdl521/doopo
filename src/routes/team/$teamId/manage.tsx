import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Users, History, Settings } from 'lucide-react'
import TeamInfoBar from '@/components/team/TeamInfoBar'
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

function TeamManagePage() {
  const navigate = useNavigate()
  const { teamId } = Route.useParams()
  const callGetTeamDetail = useServerFn(getTeamDetail)

  const [team, setTeam] = useState<TeamDetail | null>(null)
  const [myRole, setMyRole] = useState<string>('member')
  const [loading, setLoading] = useState(true)
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

  const isOwnerOrAdmin = myRole === 'owner' || myRole === 'admin'

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      <TeamInfoBar
        teamName={team.name}
        myRole={myRole}
        onEditClick={myRole === 'owner' ? () => {} : undefined}
      />

      <Tabs defaultValue="members" className="w-full">
        <TabsList className="w-full justify-start border-b rounded-none bg-transparent p-0">
          <TabsTrigger
            value="members"
            className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none data-[state=active]:shadow-none"
          >
            <Users className="w-4 h-4 mr-2" />
            成员管理
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none data-[state=active]:shadow-none"
          >
            <History className="w-4 h-4 mr-2" />
            积分记录
          </TabsTrigger>
          {myRole === 'owner' && (
            <TabsTrigger
              value="settings"
              className="data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none data-[state=active]:shadow-none"
            >
              <Settings className="w-4 h-4 mr-2" />
              设置
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="members" className="mt-6">
          <MembersTab
            key={refreshKey}
            teamId={teamId}
            myRole={myRole}
            onManageCredits={(member, mode) => setCreditTarget({ member, mode })}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <CreditsHistoryTab teamId={teamId} myRole={myRole} />
        </TabsContent>

        <TabsContent value="settings" className="mt-6">
          <SettingsTab
            teamId={teamId}
            initialName={team.name}
            initialDescription={team.description ?? ''}
            onUpdate={() => callGetTeamDetail({ data: { teamId } }).then((r: any) => {
              if (r?.team) { setTeam(r.team); setMyRole(r.myRole ?? 'member') }
            })}
          />
        </TabsContent>
      </Tabs>

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
