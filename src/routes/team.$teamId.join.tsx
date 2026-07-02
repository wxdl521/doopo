import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Users, ArrowLeft, Loader2 } from "lucide-react";
import { getTeamJoinInfo } from "@/lib/teams.functions";
import { joinTeam } from "@/lib/teamMembers.functions";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/team/$teamId/join")({
  head: () => ({ meta: [{ title: "Doopoo — 加入团队" }] }),
  component: JoinTeamPage,
});

function JoinTeamPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { teamId } = useParams({ from: "/team/$teamId/join" });
  const { isAuthenticated, loading: authLoading } = useAuth();
  const callGetInfo = useServerFn(getTeamJoinInfo);
  const callJoin = useServerFn(joinTeam);

  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [team, setTeam] = useState<{
    id: string;
    name: string;
    description: string | null;
    ownerId: string;
    createdAt: string;
  } | null>(null);
  const [isMember, setIsMember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    callGetInfo({ data: { teamId } })
      .then((r: any) => {
        if (r?.team) {
          setTeam(r.team);
          setIsMember(r.isMember ?? false);
        } else {
          setError(r?.error ?? t.team_join_not_found);
        }
      })
      .catch(() => setError(t.team_join_not_found))
      .finally(() => setLoading(false));
  }, [isAuthenticated, authLoading, teamId]);

  const handleJoin = async () => {
    setJoining(true);
    setJoinError(null);
    const r: any = await callJoin({ data: { teamId } });
    setJoining(false);
    if (r?.ok) {
      navigate({ to: "/team" });
    } else {
      setJoinError(r?.error ?? "Failed to join team");
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Users className="w-16 h-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold text-center">
          {t.team_join_title}
        </h2>
        <p className="text-muted-foreground">{t.my_team_login_hint}</p>
        <Button onClick={() => navigate({ to: "/login" })}>
          {t.my_team_login_required}
        </Button>
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Users className="w-16 h-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">{t.team_join_not_found}</h2>
        <Button variant="outline" onClick={() => navigate({ to: "/team" })}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          {t.common_back}
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-16 px-4 animate-fade-in">
      <div className="panel text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-full bg-accent-dim flex items-center justify-center">
          <Users className="w-8 h-8 text-accent" />
        </div>

        <div>
          <h1 className="text-2xl font-bold mb-2">{t.team_join_title}</h1>
          <p className="text-muted-foreground">
            {t.team_join_desc.replace("{name}", team.name)}
          </p>
          {team.description && (
            <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto line-clamp-3">
              {team.description}
            </p>
          )}
        </div>

        {isMember ? (
          <div className="space-y-3">
            <p className="text-sm text-green-600 dark:text-green-400 font-medium">
              {t.team_join_already_member}
            </p>
            <Button onClick={() => navigate({ to: "/team" })} className="w-full">
              {t.team_join_go_to_team}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {joinError && (
              <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">
                {joinError}
              </p>
            )}
            <Button
              onClick={handleJoin}
              disabled={joining}
              className="w-full"
              size="lg"
            >
              {joining ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              {t.team_join_btn}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
