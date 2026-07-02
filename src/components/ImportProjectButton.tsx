import { useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { useLanguage } from "../i18n/LanguageContext";
import {
  parseProjectFile,
  saveImportedProject,
  ProjectImportError,
  type ImportedProject,
} from "../lib/projectImport";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

export function ImportProjectButton({
  onImported,
}: {
  onImported: (project: ImportedProject) => void;
}) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportedProject | null>(null);

  const statusLabels: Record<string, string> = {
    draft: t.projects_status_draft,
    rendering: t.projects_status_rendering,
    ready: t.projects_status_ready,
  };

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const project = await parseProjectFile(files[0]);
      setPreview(project);
    } catch (e) {
      setError(e instanceof ProjectImportError ? e.message : "导入失败 / Import failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function confirmImport() {
    if (!preview) return;
    saveImportedProject(preview);
    onImported(preview);
    setPreview(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="btn-ghost"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        {t.projects_import}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {error && <span className="text-xs text-rose-400 ml-2">{error}</span>}

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.projects_import_preview_title}</DialogTitle>
            <DialogDescription>{t.projects_import_preview_hint}</DialogDescription>
          </DialogHeader>

          {preview && (
            <div className="space-y-3">
              <div
                className={`relative aspect-[16/10] rounded-lg overflow-hidden bg-gradient-to-br ${preview.thumbnail}`}
              >
                <div
                  className="absolute inset-0 opacity-30 mix-blend-overlay"
                  style={{
                    backgroundImage:
                      "linear-gradient(0deg, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
                    backgroundSize: "24px 24px",
                  }}
                />
              </div>
              <div>
                <div className="text-xs text-text-muted">{t.common_name}</div>
                <div className="font-semibold text-text-primary truncate">{preview.title}</div>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <div>
                  <div className="text-xs text-text-muted">{t.common_status}</div>
                  <div className="text-text-primary">
                    {preview.status ? statusLabels[preview.status] : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-text-muted">ID</div>
                  <div className="text-text-primary font-mono text-xs">{preview.id}</div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <button className="btn-ghost" onClick={() => setPreview(null)}>
              {t.common_cancel}
            </button>
            <button className="btn-primary" onClick={confirmImport}>
              {t.projects_import_confirm}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
