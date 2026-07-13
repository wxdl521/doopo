import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Plus, Coins } from "lucide-react";
import { createTeam } from "@/lib/teams.functions";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/team/create")({
  head: () => ({ meta: [{ title: "Doopoo — 创建团队" }] }),
  component: CreateTeamPage,
});

function CreateTeamPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const callCreateTeam = useServerFn(createTeam);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [credits, setCredits] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const r: any = await callCreateTeam({
        data: {
          name: name.trim(),
          description: description.trim() || undefined,
          credits: credits ? parseInt(credits, 10) : undefined,
        },
      });

      if (r?.ok && r.teamId) {
        navigate({ to: "/team" });
      } else {
        setError(r?.error ?? t.team_create_error);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : t.team_create_error);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto py-12 px-4">
      <button
        onClick={() => navigate({ to: "/team" })}
        className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary mb-6 transition"
      >
        <ArrowLeft size={16} />
        {t.team_create_back}
      </button>

      <Card>
        <CardHeader>
          <CardTitle>{t.team_create_title}</CardTitle>
          <CardDescription>{t.team_create_desc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="team-name">{t.settings_team_name}</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.settings_team_name_placeholder}
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="team-desc">{t.settings_team_desc}</Label>
            <Textarea
              id="team-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.settings_team_desc_placeholder}
              maxLength={500}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="team-credits" className="flex items-center gap-1.5">
              <Coins className="w-4 h-4 text-amber-500" />
              {t.team_create_initial_credits}
            </Label>
            <Input
              id="team-credits"
              type="number"
              min={0}
              max={99999999}
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              placeholder="0"
            />
            <p className="text-xs text-text-muted">{t.team_create_initial_credits_desc}</p>
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</p>
          )}

          <Button onClick={handleCreate} disabled={creating || !name.trim()} className="w-full">
            <Plus className="w-4 h-4 mr-2" />
            {creating ? t.team_create_creating : t.team_create_submit}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
