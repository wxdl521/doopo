import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Users,
  History,
  Settings,
  LayoutDashboard,
  Shield,
  LogOut,
  Crown,
  UserCog,
  User,
  Plus,
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import MembersTab from "@/components/team/MembersTab";
import CreditsHistoryTab from "@/components/team/CreditsHistoryTab";
import SettingsTab from "@/components/team/SettingsTab";
import CreditManageDialog from "@/components/team/CreditManageDialog";
import { getMyTeams, getTeamDetail } from "@/lib/teams.functions";
import { leaveTeam } from "@/lib/teamMembers.functions";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/i18n/LanguageContext";
import type { MemberRow } from "@/lib/teamMembers.functions";

export const Route = createFileRoute("/team/")({
  head: () => ({ meta: [{ title: "Doopoo — 团队" }] }),
  component: TeamPage,
});

const ROLE_BADGE_COLOR: Record<string, "default" | "secondary" | "outline"> = {
  owner: "default",
  admin: "secondary",
  member: "outline",
};

const TABS = [
  { id: "overview", icon: LayoutDashboard },
  { id: "members", icon: Users },
  { id: "history", icon: History },
  { id: "settings", icon: Settings, ownerOnly: true },
] as const;

type TeamDetail = {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

function TeamPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const callGetMyTeams = useServerFn(getMyTeams);
  const callGetTeamDetail = useServerFn(getTeamDetail);
  const callLeaveTeam = useServerFn(leaveTeam);

  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [myRole, setMyRole] = useState<string>("member");
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  const [creditTarget, setCreditTarget] = useState<{
    member: MemberRow;
    mode: "allocate" | "reclaim";
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    callGetMyTeams({ data: {} })
      .then((r: any) => {
        if (r?.teams) setTeams(r.teams);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAuthenticated, authLoading, callGetMyTeams]);

  useEffect(() => {
    if (teams.length === 0) return;
    callGetTeamDetail({ data: { teamId: teams[0].id } })
      .then((r: any) => {
        if (r?.team) {
          setTeam(r.team);
          setMyRole(r.myRole ?? "member");
        }
      })
      .catch(() => {});
  }, [teams, callGetTeamDetail]);

  const handleLeave = async () => {
    if (!leaveTarget) return;
    const r: any = await callLeaveTeam({ data: { teamId: leaveTarget } });
    if (r?.ok) {
      setTeams([]);
      setTeam(null);
    }
    setLeaveTarget(null);
  };

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <section className="panel flex flex-col items-center gap-4 py-16">
        <Users className="w-16 h-16 text-text-muted" />
        <h2 className="text-xl font-semibold">{t.my_team_login_required}</h2>
        <p className="text-text-muted">{t.my_team_login_hint}</p>
      </section>
    );
  }

  if (teams.length === 0) {
    return (
      <section className="panel flex flex-col items-center gap-4 py-16">
        <Users className="w-12 h-12 text-text-muted" />
        <div className="text-center">
          <h3 className="font-semibold text-lg mb-1">{t.my_team_empty_title}</h3>
          <p className="text-sm text-text-muted">{t.my_team_empty_desc}</p>
        </div>
        <Button onClick={() => navigate({ to: "/team/create" })}>
          <Plus className="w-4 h-4 mr-2" />
          {t.my_team_create}
        </Button>
      </section>
    );
  }

  if (!team) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const roleConfig: Record<string, { label: string; icon: typeof Crown }> = {
    owner: { label: t.team_manage_role_owner, icon: Crown },
    admin: { label: t.team_manage_role_admin, icon: UserCog },
    member: { label: t.team_manage_role_member, icon: User },
  };
  const roleInfo = roleConfig[myRole] ?? roleConfig.member;
  const RoleIcon = roleInfo.icon;

  const visibleTabs = TABS.filter((tab) => !tab.ownerOnly || myRole === "owner");
  const teamId = team.id;
  const isOwner = myRole === "owner";

  const tabLabels: Record<string, string> = {
    overview: t.team_manage_overview,
    members: t.team_manage_members,
    history: t.team_manage_history,
    settings: t.team_manage_settings,
  };

  return (
    <div className="animate-fade-in space-y-6">
      {/* 顶部标题栏 — 对齐 home/projects */}
      <PageHeader
        title={team.name}
        subtitle={team.description ?? undefined}
        actions={
          <div className="flex items-center gap-3">
            <Badge
              variant={ROLE_BADGE_COLOR[myRole] ?? "outline"}
              className="flex items-center gap-1.5"
            >
              <RoleIcon className="w-3.5 h-3.5" />
              {roleInfo.label}
            </Badge>
            {!isOwner && (
              <Button variant="outline" size="sm" onClick={() => setLeaveTarget(teamId)}>
                <LogOut className="w-4 h-4 mr-2" />
                {t.my_team_leave}
              </Button>
            )}
          </div>
        }
      />

      {/* Tab 导航 + 内容区 */}
      <section className="panel">
        {/* Tab 导航 — 顶部横向 */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/50 w-fit mb-6">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                <Icon size={15} />
                <span>{tabLabels[tab.id]}</span>
              </button>
            );
          })}
        </div>

        {/* 内容区 */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* 团队信息 */}
            <section className="panel">
              <div className="flex items-center gap-6 text-sm text-text-muted mb-4">
                <span>
                  {t.my_team_created_at}：{new Date(team.createdAt).toLocaleDateString("zh-CN")}
                </span>
              </div>

              <Separator className="my-4" />

              <div className="flex items-center gap-3">
                {(myRole === "owner" || myRole === "admin") && (
                  <Button onClick={() => setActiveTab("members")}>
                    <Users className="w-4 h-4 mr-2" />
                    {t.my_team_manage}
                  </Button>
                )}
                {isOwner && (
                  <p className="text-xs text-text-muted">{t.my_team_owner_cannot_leave}</p>
                )}
              </div>
            </section>

            {/* 团队规则 */}
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { icon: Users, title: t.my_team_rule_1_title, desc: t.my_team_rule_1_desc },
                { icon: Shield, title: t.my_team_rule_2_title, desc: t.my_team_rule_2_desc },
                { icon: Settings, title: t.my_team_rule_3_title, desc: t.my_team_rule_3_desc },
              ].map((rule) => (
                <div key={rule.title} className="panel flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-accent-dim flex items-center justify-center shrink-0">
                    <rule.icon className="w-4 h-4 text-accent" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm mb-0.5">{rule.title}</h4>
                    <p className="text-xs text-text-muted">{rule.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "members" && (
          <MembersTab
            key={refreshKey}
            teamId={teamId}
            myRole={myRole}
            onManageCredits={(member, mode) => setCreditTarget({ member, mode })}
          />
        )}
        {activeTab === "history" && <CreditsHistoryTab teamId={teamId} myRole={myRole} />}
        {activeTab === "settings" && (
          <SettingsTab
            teamId={teamId}
            initialName={team.name}
            initialDescription={team.description ?? ""}
            onUpdate={() =>
              callGetTeamDetail({ data: { teamId } }).then((r: any) => {
                if (r?.team) {
                  setTeam(r.team);
                  setMyRole(r.myRole ?? "member");
                }
              })
            }
          />
        )}
      </section>

      <CreditManageDialog
        open={!!creditTarget}
        teamId={teamId}
        member={creditTarget?.member ?? null}
        mode={creditTarget?.mode ?? "allocate"}
        onClose={() => setCreditTarget(null)}
        onSuccess={() => setRefreshKey((k) => k + 1)}
      />

      <AlertDialog open={!!leaveTarget} onOpenChange={(open) => !open && setLeaveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.my_team_leave_confirm_title}</AlertDialogTitle>
            <AlertDialogDescription>{t.my_team_leave_confirm_desc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common_cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLeave}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.my_team_leave_confirm_btn}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
