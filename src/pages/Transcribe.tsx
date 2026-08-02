import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Download, FileAudio, Loader2, Save, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PageHeader from "@/components/PageHeader";
import { useLanguage } from "@/i18n/LanguageContext";
import { AudioExtractError, extractAudioSlices } from "@/lib/audioExtract";
import { transcribeAudioChunk } from "@/lib/transcribeAudio.functions";
import { upsertScriptRemote } from "@/lib/scripts.functions";
import {
  buildTranscriptLines,
  downloadTextFile,
  formatTimecode,
  toPlainText,
  toSrt,
  type TranscribedChunk,
  type TranscriptLine,
} from "@/lib/transcriptFormat";

const ACCEPT = "audio/*,video/*";

export default function Transcribe() {
  const { t } = useLanguage();
  const runTranscribe = useServerFn(transcribeAudioChunk);
  const saveScript = useServerFn(upsertScriptRemote);

  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [warning, setWarning] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [scriptTitle, setScriptTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const abortRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const plainText = useMemo(() => toPlainText(lines), [lines]);
  const baseName = useMemo(() => (file?.name ?? "transcript").replace(/\.[^.]+$/, ""), [file]);

  const pickFile = (next: File | null) => {
    if (!next) return;
    setFile(next);
    setLines([]);
    setWarning("");
    setProgress({ done: 0, total: 0 });
  };

  const start = async () => {
    if (!file || running) return;
    setRunning(true);
    setWarning("");
    setLines([]);
    abortRef.current = false;
    try {
      const slices = await extractAudioSlices(file);
      setProgress({ done: 0, total: slices.length });
      const chunks: TranscribedChunk[] = [];
      let lastError = "";
      for (const slice of slices) {
        if (abortRef.current) break;
        const result = await runTranscribe({
          data: {
            audioBase64: slice.audioBase64,
            format: "wav" as const,
            offsetSeconds: slice.offsetSeconds,
            durationSec: slice.durationSec,
          },
        });
        if (result.ok) {
          if (result.text) {
            chunks.push({
              text: result.text,
              offsetSeconds: result.offsetSeconds,
              durationSec: result.durationSec,
            });
          }
        } else {
          lastError = result.error;
        }
        setProgress((prev) => ({ ...prev, done: prev.done + 1 }));
        setLines(buildTranscriptLines(chunks));
      }
      if (lastError) setWarning(lastError);
      if (chunks.length === 0 && !lastError) setWarning(t.transcribe_empty_result);
      if (chunks.length > 0) toast.success(t.transcribe_done);
    } catch (error) {
      const message =
        error instanceof AudioExtractError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      setWarning(message);
      toast.error(message);
    } finally {
      setRunning(false);
    }
  };

  const updateLine = (id: string, patch: Partial<TranscriptLine>) => {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  const copyAll = async () => {
    await navigator.clipboard.writeText(plainText);
    toast.success(t.transcribe_copied);
  };

  const persistScript = async () => {
    const title = scriptTitle.trim() || baseName || t.transcribe_title;
    setSaving(true);
    try {
      await saveScript({
        data: {
          script: {
            id: `transcript-${Date.now()}`,
            title,
            plot: plainText.slice(0, 20_000),
            type: "",
            genre: "",
            tone: "",
          },
        },
      });
      toast.success(t.transcribe_saved_script);
      setSaveOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.transcribe_save_failed);
    } finally {
      setSaving(false);
    }
  };

  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title={t.transcribe_title} subtitle={t.transcribe_subtitle} />

      <div className="rounded-xl border border-border bg-bg-soft/40 p-5">
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            pickFile(event.dataTransfer.files?.[0] ?? null);
          }}
          onClick={() => inputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center transition-colors hover:border-primary/60"
        >
          <FileAudio className="text-muted-foreground" size={28} />
          <p className="text-sm font-medium text-foreground">
            {file ? file.name : t.transcribe_dropzone}
          </p>
          <p className="text-xs text-muted-foreground">{t.transcribe_dropzone_hint}</p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={start} disabled={!file || running}>
            {running ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
            {running ? t.transcribe_running : t.transcribe_start}
          </Button>
          {running && (
            <Button
              variant="outline"
              onClick={() => {
                abortRef.current = true;
              }}
            >
              <X size={16} />
              {t.transcribe_stop}
            </Button>
          )}
          {progress.total > 0 && (
            <span className="text-xs text-muted-foreground">
              {t.transcribe_progress} {progress.done}/{progress.total}
            </span>
          )}
        </div>
        {progress.total > 0 && <Progress className="mt-3" value={percent} />}
        {warning && <p className="mt-3 text-sm text-destructive">{warning}</p>}
      </div>

      {lines.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-xl border border-border bg-bg-soft/40 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-sm font-semibold text-foreground">
                {t.transcribe_lines_title}
              </h2>
              <Button size="sm" variant="outline" onClick={copyAll}>
                <Copy size={14} />
                {t.transcribe_copy}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadTextFile(`${baseName}.srt`, toSrt(lines))}
              >
                <Download size={14} />
                SRT
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadTextFile(`${baseName}.txt`, plainText)}
              >
                <Download size={14} />
                TXT
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setScriptTitle(baseName);
                  setSaveOpen(true);
                }}
              >
                <Save size={14} />
                {t.transcribe_save_script}
              </Button>
            </div>

            <div className="space-y-2">
              {lines.map((line) => (
                <div
                  key={line.id}
                  className="grid gap-2 rounded-lg border border-border/70 bg-background/60 p-2 sm:grid-cols-[76px_120px_1fr]"
                >
                  <span className="self-center text-xs font-mono text-muted-foreground">
                    {formatTimecode(line.beginMs)}
                  </span>
                  <Input
                    value={line.speaker}
                    placeholder={t.transcribe_speaker}
                    onChange={(event) => updateLine(line.id, { speaker: event.target.value })}
                    className="h-8 text-xs"
                  />
                  <Textarea
                    value={line.text}
                    onChange={(event) => updateLine(line.id, { text: event.target.value })}
                    className="min-h-[38px] text-sm"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-bg-soft/40 p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              {t.transcribe_plain_title}
            </h2>
            <Textarea readOnly value={plainText} className="min-h-[420px] font-mono text-xs" />
          </div>
        </div>
      )}

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.transcribe_save_script}</DialogTitle>
            <DialogDescription>{t.transcribe_save_hint}</DialogDescription>
          </DialogHeader>
          <Input
            value={scriptTitle}
            onChange={(event) => setScriptTitle(event.target.value)}
            placeholder={t.transcribe_script_title}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              {t.transcribe_cancel}
            </Button>
            <Button onClick={persistScript} disabled={saving}>
              {saving && <Loader2 className="animate-spin" size={16} />}
              {t.transcribe_confirm_save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}