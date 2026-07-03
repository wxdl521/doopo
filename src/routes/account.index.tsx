import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import { Coins, Award, FolderOpen, Bell } from "lucide-react";
import { listMyProjects } from "../lib/projects.functions";
import { getMyTeams } from "../lib/teams.functions";
import { getUserBalance } from "../lib/userCredits.functions";
import { useAuth } from "../hooks/useAuth";
import { useLanguage } from "../i18n/LanguageContext";

export const Route = createFileRoute("/account/")({
  component: AccountOverview,
});

const ROLE_LABEL: Record<string, string> = {
  owner: "所有者",
  admin: "管理员",
  member: "成员",
};

function AccountOverview() {
  const { t } = useLanguage();
  const { user, loading: authLoading } = useAuth();
  const callListProjects = useServerFn(listMyProjects);
  const callGetMyTeams = useServerFn(getMyTeams);
  const callGetBalance = useServerFn(getUserBalance);

  const [projectCount, setProjectCount] = useState<number | null>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [subtitle, setSubtitle] = useState<string>("");

  useEffect(() => {
    if (authLoading || !user) return;

    callGetBalance({ data: undefined })
      .then((r: any) => setCreditBalance(r?.balance ?? 0))
      .catch(() => setCreditBalance(0));

    callListProjects({ data: {} })
      .then((r: any) => {
        if (r?.projects) setProjectCount(r.projects.length);
      })
      .catch(() => {});

    callGetMyTeams({ data: {} })
      .then((r: any) => {
        const teams: any[] = r?.teams ?? [];
        // 优先取 owner 角色的团队，其次第一个团队
        const ownerTeam = teams.find((t: any) => t.role === "owner");
        const team = ownerTeam ?? teams[0];

        const roleLabel = team ? (ROLE_LABEL[team.role] ?? team.role) : null;
        const teamName = team?.name ?? null;
        const createdAt = user?.created_at
          ? new Date(user.created_at).toISOString().slice(0, 10)
          : null;

        if (roleLabel && teamName && createdAt) {
          setSubtitle(`${roleLabel} · ${teamName} · 自 ${createdAt} 加入`);
        } else if (createdAt) {
          setSubtitle(`个人用户 · 暂未加入团队 · 注册于 ${createdAt}`);
        } else {
          setSubtitle("个人用户，暂未加入团队");
        }
      })
      .catch(() => {
        setSubtitle("个人用户，暂未加入团队");
      });
  }, [authLoading, user]);

  const displayName =
    user?.user_metadata?.display_name ??
    user?.user_metadata?.full_name ??
    user?.user_metadata?.name ??
    user?.email ??
    "-";

  return (
    <>
      <PageHeader title={`${t.account_hi}${displayName}`} subtitle={subtitle || "..."} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={Coins}
          label={t.account_points_balance}
          value={creditBalance != null ? creditBalance : "..."}
          hint={t.account_points_rollover}
        />
        <StatCard icon={Award} label={t.account_level} value={"-"} tone="success" />
        <StatCard
          icon={FolderOpen}
          label={t.account_my_projects}
          value={projectCount != null ? projectCount : "..."}
        />
        <StatCard icon={Bell} label={t.account_unread} value={"-"} />
      </div>
      <div className="panel p-6">
        <h3 className="font-display text-lg font-bold mb-3">{t.account_profile}</h3>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-text-muted text-xs mb-1">{t.account_display_name}</div>
            <div>{displayName}</div>
          </div>
          <div>
            <div className="text-text-muted text-xs mb-1">{t.common_email}</div>
            <div>{user?.email ?? "-"}</div>
          </div>
          <div>
            <div className="text-text-muted text-xs mb-1">{t.account_workspace}</div>
            <div>-</div>
          </div>
          <div>
            <div className="text-text-muted text-xs mb-1">{t.account_plan}</div>
            <div>-</div>
          </div>
        </div>
      </div>
    </>
  );
}
