import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Save } from "lucide-react";
import { updateTeam, deleteTeam } from "@/lib/teams.functions";
import { useLanguage } from "@/i18n/LanguageContext";

type SettingsTabProps = {
  teamId: string;
  initialName: string;
  initialDescription: string;
  onUpdate: () => void;
};

export default function SettingsTab({
  teamId,
  initialName,
  initialDescription,
  onUpdate,
}: SettingsTabProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const callUpdateTeam = useServerFn(updateTeam);
  const callDeleteTeam = useServerFn(deleteTeam);

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [showDissolve, setShowDissolve] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [dissolveStep, setDissolveStep] = useState<"confirm" | "final">("confirm");
  const [dissolving, setDissolving] = useState(false);
  const [dissolveError, setDissolveError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);

    const r: any = await callUpdateTeam({
      data: { teamId, name: name.trim(), description: description.trim() || undefined },
    });

    setSaving(false);
    if (r?.ok) {
      setSaved(true);
      onUpdate();
      setTimeout(() => setSaved(false), 3000);
    } else {
      setSaveError(r?.error ?? t.common_save_error);
    }
  };

  const handleDissolve = async () => {
    setDissolving(true);
    setDissolveError(null);
    try {
      const r: any = await callDeleteTeam({ data: { teamId } });
      if (r?.ok) {
        setShowDissolve(false);
        navigate({ to: "/team" });
      } else {
        setDissolveError(r?.error ?? t.common_save_error);
      }
    } catch (error) {
      setDissolveError(error instanceof Error ? error.message : t.common_save_error);
    } finally {
      setDissolving(false);
    }
  };

  const openDissolve = () => {
    setShowDissolve(true);
    setDissolveStep("confirm");
    setConfirmName("");
    setDissolveError(null);
  };

  return (
    <div className="space-y-6">
      {/* 基本信息 */}
      <section className="panel">
        <h3 className="font-display text-lg font-bold mb-1">{t.settings_basic_info}</h3>
        <p className="text-sm text-text-muted mb-4">{t.settings_basic_desc}</p>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="team-name">{t.settings_team_name}</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
              placeholder={t.settings_team_name_placeholder}
              maxLength={100}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="team-desc">{t.settings_team_desc}</Label>
            <Textarea
              id="team-desc"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setSaved(false);
              }}
              placeholder={t.settings_team_desc_placeholder}
              maxLength={500}
              rows={3}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? t.settings_saving : t.settings_save}
            </Button>
            {saved && <span className="text-sm text-green-500">{t.settings_saved}</span>}
            {saveError && <span className="text-sm text-destructive">{saveError}</span>}
          </div>
        </div>
      </section>

      {/* 危险操作 */}
      <section className="panel border-destructive/30">
        <h3 className="font-display text-lg font-bold text-destructive flex items-center gap-2 mb-1">
          <AlertTriangle className="w-5 h-5" />
          {t.settings_danger_title}
        </h3>
        <p className="text-sm text-text-muted mb-4">{t.settings_danger_desc}</p>
        <Button variant="destructive" onClick={openDissolve}>
          {t.settings_dissolve}
        </Button>
      </section>

      {/* 解散确认弹窗 */}
      <AlertDialog
        open={showDissolve}
        onOpenChange={(open) => {
          if (!open) {
            setShowDissolve(false);
            setDissolveStep("confirm");
          }
        }}
      >
        <AlertDialogContent>
          {dissolveStep === "confirm" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-destructive">
                  {t.settings_dissolve_confirm_title}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  <p className="mb-3">{t.settings_dissolve_confirm_desc}</p>
                  <Label htmlFor="confirm-name" className="text-foreground">
                    {t.settings_dissolve_confirm_input.replace("{name}", initialName)}
                  </Label>
                  <Input
                    id="confirm-name"
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    placeholder={initialName}
                    className="mt-1.5"
                  />
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setShowDissolve(false)}>
                  {t.common_cancel}
                </AlertDialogCancel>
                <Button
                  type="button"
                  disabled={confirmName !== initialName}
                  onClick={() => setDissolveStep("final")}
                  variant="destructive"
                >
                  {t.settings_dissolve_continue}
                </Button>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-destructive">
                  {t.settings_dissolve_final_title}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t.settings_dissolve_final_desc.replace("{name}", initialName)}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {dissolveError && (
                <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">
                  {dissolveError}
                </p>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setDissolveStep("confirm")}>
                  {t.settings_dissolve_back}
                </AlertDialogCancel>
                <Button
                  type="button"
                  onClick={handleDissolve}
                  disabled={dissolving}
                  variant="destructive"
                >
                  {dissolving ? t.settings_dissolve_processing : t.settings_dissolve_confirm_btn}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
