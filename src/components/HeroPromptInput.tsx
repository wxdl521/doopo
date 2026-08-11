import { useState, useRef, useEffect } from "react";
import {
  ArrowRight,
  ChevronDown,
  FileText,
  ImagePlus,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  X,
  MessageCircle,
  Film,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useLanguage } from "../i18n/LanguageContext";
import { useAuth } from "../hooks/useAuth";
import { useListedModels } from "../hooks/useListedModels";
import {
  formatModelOptionLabel,
  resolveDefaultModel,
  sortListedModels,
} from "../hooks/modelOptions";
import { TEXT_MODEL_FALLBACK } from "../lib/textModelOptions";
import { NewProjectDialog } from "./NewProjectDialog";

export default function HeroPromptInput() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  // 文本模型目录：统一走 useListedModels("text")，label 用全站统一纯文本后缀
  // （废除原 🟠/🟣 手工 emoji 与本地硬编码列表，fallback 收敛到 textModelOptions）。
  // 控件保持现有自定义下拉形态（非原生 select），仅统一数据源与 label 格式。
  const { models: catalogTextModels } = useListedModels("text", TEXT_MODEL_FALLBACK);
  const badgeLabels = {
    unpricedLabel: t.listed_model_unpriced,
    defaultLabel: t.restyle_setup_col_default,
  };
  const AI_MODELS = sortListedModels(catalogTextModels).map((m) => ({
    id: m.id,
    label: formatModelOptionLabel(m, badgeLabels),
    desc: m.sub ?? "",
  }));
  const placeholders = [
    t.prompt_placeholder_1,
    t.prompt_placeholder_2,
    t.prompt_placeholder_3,
    t.prompt_placeholder_4,
  ];

  const [value, setValue] = useState("");
  const [selectedModel, setSelectedModel] = useState<(typeof AI_MODELS)[number] | null>(null);
  const [showModels, setShowModels] = useState(false);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState("");
  const [showResponse, setShowResponse] = useState(false);
  const [error, setError] = useState("");
  // 目录到达前 selectedModel 为 null；用统一默认值链（已保存 → is_default → sortOrder → 兜底）
  useEffect(() => {
    if (!AI_MODELS.length) return;
    setSelectedModel((current) =>
      current && AI_MODELS.some((m) => m.id === current.id)
        ? current
        : AI_MODELS.find(
            (m) =>
              m.id === resolveDefaultModel(catalogTextModels, undefined, TEXT_MODEL_FALLBACK[0].id),
          )!,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogTextModels]);
  // ⚠️ 必须 SSR-safe:初值用 0(跟服务端 HTML 一致),挂载后再随机。
  // 用 useState(() => Math.random()) 会让 server 渲染一个 placeholder,client
  // 渲染另一个,触发 React hydration mismatch warning。
  const [phIndex, setPhIndex] = useState(0);
  useEffect(() => {
    setPhIndex(Math.floor(Math.random() * placeholders.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 剧本生成模式：开启后点击"创建"直接跳转剧本页
  const [scriptMode, setScriptMode] = useState(false);
  // 项目创建弹窗开关
  const [npOpen, setNpOpen] = useState(false);

  const goToScripts = () => {
    try {
      sessionStorage.setItem(
        "script_prefill",
        JSON.stringify({ type: "", genre: "", tone: "", theme: "", plot: value.trim() }),
      );
    } catch {}
    if (!isAuthenticated) {
      navigate({ to: "/login", search: { redirect: undefined } });
    } else {
      navigate({ to: "/scripts" });
    }
  };

  const handleCreate = async () => {
    if (!value.trim() || loading) return;
    if (scriptMode) {
      goToScripts();
      return;
    }
    // 将输入文本暂存，供项目创建后 workspace 右侧对话框预填
    try {
      sessionStorage.setItem("workspace_prefill", value.trim());
      sessionStorage.setItem("workspace_prefill_mode", "script");
    } catch {}
    setNpOpen(true);
  };

  const closeResponse = () => {
    setShowResponse(false);
    setResponse("");
    setError("");
  };

  return (
    <div className="space-y-4">
      {/* 输入区 */}
      <div className="relative">
        <div className="absolute -inset-4 bg-glow-orb opacity-70 blur-2xl pointer-events-none" />
        <div className="relative corner-frame panel p-5 md:p-6 animate-slide-up">
          <span className="c-tr" />
          <span className="c-bl" />

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholders[phIndex]}
            rows={3}
            className="w-full bg-transparent resize-none outline-none text-text-primary placeholder:text-text-muted
                       text-base md:text-lg leading-relaxed"
          />

          <div className="mt-4 flex flex-wrap items-center gap-2 md:gap-3">
            <button className="btn-ghost !px-3" title={t.hero_attach}>
              <Plus size={16} />
            </button>
            <button className="btn-ghost">
              <FileText size={15} /> {t.hero_upload_script}
            </button>
            <button className="btn-ghost">
              <ImagePlus size={15} /> {t.hero_upload_storyboard}
            </button>

            {/* 剧本生成模式切换 */}
            <button
              onClick={() => setScriptMode((s) => !s)}
              className={`btn-ghost ${scriptMode ? "border-accent/50 bg-accent-dim text-accent" : ""}`}
              title={t.hero_script_entry}
            >
              <Film size={14} className={scriptMode ? "text-accent" : "text-accent"} />
              {t.hero_script_entry}
              {scriptMode && <span className="ml-1 text-[10px] opacity-80">●</span>}
            </button>

            {/* 模型选择器 */}
            <div className="relative" hidden={scriptMode}>
              <button onClick={() => setShowModels((s) => !s)} className="btn-ghost">
                <RefreshCw size={14} className="text-accent" />
                {selectedModel?.label ?? AI_MODELS[0]?.label}
                <ChevronDown size={14} className="opacity-60" />
              </button>
              {showModels && (
                <div className="absolute left-0 top-full mt-2 w-64 panel p-1.5 z-20 animate-fade-in shadow-glow">
                  {AI_MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setSelectedModel(m);
                        setShowModels(false);
                      }}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition
                        ${
                          m.id === selectedModel?.id
                            ? "bg-accent-dim text-accent border border-accent/30"
                            : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
                        }`}
                    >
                      <div className="font-medium">{m.label}</div>
                      <div className="text-xs opacity-60 mt-0.5">
                        {m.desc} · {m.id}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2 text-xs text-text-muted">
              <span className="hidden md:inline">
                {value.length} {t.hero_chars_suffix}
              </span>
              <button
                onClick={handleCreate}
                disabled={!value.trim() || loading}
                className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : scriptMode ? (
                  <Film size={14} />
                ) : (
                  <Sparkles size={14} />
                )}
                {loading ? t.hero_thinking : scriptMode ? t.hero_script_start : t.hero_create}
                {!loading && <ArrowRight size={14} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* AI 回复区 */}
      {showResponse && (
        <div className="panel p-5 animate-slide-up border-accent/20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <MessageCircle size={14} className="text-accent" />
              <span>{t.hero_ai_reply}</span>
              <span className="text-xs text-text-muted">· {selectedModel?.label}</span>
            </div>
            <button onClick={closeResponse} className="btn-ghost !px-2 !py-1 text-xs">
              <X size={12} /> {t.hero_close}
            </button>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-text-muted text-sm">
              <Loader2 size={14} className="animate-spin" />
              {t.hero_generating_reply}
            </div>
          )}

          {error && (
            <div className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3">
              ⚠️ {error}
            </div>
          )}

          {response && !loading && (
            <div className="text-text-primary text-sm leading-relaxed whitespace-pre-wrap bg-bg-elevated rounded-xl px-4 py-3 border border-border/50">
              {response}
            </div>
          )}
        </div>
      )}

      {/* 项目创建弹窗（受控） */}
      <NewProjectDialog open={npOpen} onOpenChange={setNpOpen} />
    </div>
  );
}

function ChipRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-text-muted mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = opt === value;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={`px-2.5 py-1 rounded-full text-xs border transition ${
                active
                  ? "bg-accent text-bg-base border-accent font-medium"
                  : "bg-bg-elevated text-text-secondary border-border hover:text-text-primary hover:border-accent/40"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
