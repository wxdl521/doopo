import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Users, Loader2 } from "lucide-react";
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
  const callJoin = useServerFn(joinTeam);

  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (authLoading) {
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
        <h2 className="text-xl font-semibold">{t.team_join_title}</h2>
        <p className="text-muted-foreground">{t.my_team_login_hint}</p>
        <Button onClick={() => navigate({ to: "/login" })}>
          {t.my_team_login_required}
        </Button>
      </div>
    );
  }

  const handleJoin = async () => {
    setJoining(true);
    setError(null);
    const r: any = await callJoin({ data: { teamId } });
    setJoining(false);
    if (r?.ok) {
      navigate({ to: "/team" });
    } else {
      setError(r?.error ?? t.team_join_not_found);
    }
  };

  return (
    <div className="max-w-md mx-auto py-16 px-4 animate-fade-in">
      <div className="panel text-center space-y-6">
        <div className="w-16 h-16 mx-auto rounded-full bg-accent-dim flex items-center justify-center">
          <Users className="w-8 h-8 text-accent" />
        </div>

        <div>
          <h1 className="text-2xl font-bold mb-2">{t.team_join_title}</h1>
          <p className="text-muted-foreground">{t.team_join_desc}</p>
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 p-3 rounded">{error}</p>
        )}

        <Button onClick={handleJoin} disabled={joining} className="w-full" size="lg">
          {joining ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          {t.team_join_btn}
        </Button>
      </div>
    </div>
  );
}
