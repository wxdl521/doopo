import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Save,
  Check,
  Send,
  Bot,
  User as UserIcon,
  History,
  RotateCcw,
  Pencil,
  StopCircle,
  ChevronUp,
  ChevronDown,
  X,
} from "lucide-react";
import { useLanguage } from "../../i18n/LanguageContext";
import {
  streamSynopsis,
  streamEpisodeScenes,
  refineSynopsis,
} from "../../lib/scriptAgent.functions";
import {
  findScript,
  upsertScriptAndCloud,
  ensureScriptCover,
  type SavedScript,
} from "../../lib/scriptStorage";
import { uploadScriptCover } from "../../lib/scripts.covers.functions";
import TagMultiSelect from "./TagMultiSelect";
import {
  SCRIPT_GENRE_GROUPS,
  SCRIPT_TONE_GROUP,
  scriptTagLabel,
  type ScriptTagDef,
} from "../../lib/scriptTags";

// 5 步对话式剧本智能体
type Stage = "setup" | "synopsis" | "episode" | "episodes" | "done";
const STAGES: Stage[] = ["setup", "synopsis", "episode", "episodes", "done"];
const STAGE_LABELS: Record<Stage, string> = {
  setup: "sc_stage_setup",
  synopsis: "sc_stage_synopsis",
  episode: "sc_stage_episode",
  episodes: "sc_stage_episodes",
  done: "sc_stage_done",
};

type Bubble = {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  streaming?: boolean;
  stage?: Stage;
};

type Props = {
  types: { value: string; key: keyof ReturnType<typeof useLanguage>["t"] }[];
  genres: ScriptTagDef[];
  tones: ScriptTagDef[];
  models: { id: string; label: string }[];
  onSaved?: () => void;
};

// 合并后的题材+风格标签类型
export type TagOption = { value: string; label: string; group: "genre" | "tone"; locked?: boolean };

type StreamChunk = { delta: string } | { done: true; text: string } | { error: string };

export default function ScriptComposer({ types, genres, tones, models, onSaved }: Props) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const callSynopsis = useServerFn(streamSynopsis);
  const callEpisode = useServerFn(streamEpisodeScenes);
  const callRefine = useServerFn(refineSynopsis);
  const callUploadCover = useServerFn(uploadScriptCover);

  const [stage, setStage] = useState<Stage>("setup");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 输入
  const [type, setType] = useState("Short");
  const [selectedTags, setSelectedTags] = useState<string[]>(["Drama", "Serious"]);
  const [model, setModel] = useState(models[0]?.id ?? "");
  const [theme, setTheme] = useState("");
  const [plot, setPlot] = useState("");
  const [expectedEpisodes, setExpectedEpisodes] = useState(100);
  const [totalMinutes, setTotalMinutes] = useState(90);
  const [sceneCount, setSceneCount] = useState(15);

  // 从首页 Hero 入口带入的预填值（仅一次）
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("script_prefill");
      if (!raw) return;
      sessionStorage.removeItem("script_prefill");
      const data = JSON.parse(raw) as {
        type?: string;
        genre?: string;
        tone?: string;
        theme?: string;
        plot?: string;
      };
      const allowedTypes = types.map((x) => x.value);
      const allowedTags = [...genres, ...tones].map((x) => x.value);
      if (data.type && allowedTypes.includes(data.type)) setType(data.type);
      const tagValues: string[] = [];
      if (data.genre && allowedTags.includes(data.genre)) tagValues.push(data.genre);
      if (data.tone && allowedTags.includes(data.tone)) tagValues.push(data.tone);
      if (tagValues.length > 0) setSelectedTags(tagValues);
      if (data.plot) setPlot((cur) => cur || data.plot!);
      if (data.theme) setTheme((cur) => cur || data.theme!);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 流式聚合结果
  const [synopsisText, setSynopsisText] = useState("");
  // 可编辑梗概草稿（用户在确认前可以手动改 / AI 精修）
  const [synopsisDraft, setSynopsisDraft] = useState("");
  // AI 精修候选（流式中或待采纳）
  const [refineCandidate, setRefineCandidate] = useState("");
  const [refineStreaming, setRefineStreaming] = useState(false);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [refineHistory, setRefineHistory] = useState<{ role: "user" | "agent"; text: string }[]>(
    [],
  );
  // 梗概版本快照（采纳 AI 改写或重新生成时记录）
  const [synopsisVersions, setSynopsisVersions] = useState<
    { id: string; text: string; source: "ai-init" | "ai-refine" | "manual"; createdAt: string }[]
  >([]);
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([]);
  // 下一集要生成的集号 / 分镜数
  const [nextEpIndex, setNextEpIndex] = useState(2);
  const [nextSceneCount, setNextSceneCount] = useState(15);
  // 自动连续生成至第 N 集
  const [targetEpisode, setTargetEpisode] = useState(10);
  const [autoRunning, setAutoRunning] = useState(false);
  const stopAutoRef = useRef(false);

  // 聊天气泡
  const [bubbles, setBubbles] = useState<Bubble[]>([
    {
      id: "welcome",
      role: "agent",
      text: t.sc_welcome,
    },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [bubbles]);

  const pushBubble = (b: Omit<Bubble, "id">) => {
    const id = `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setBubbles((prev) => [...prev, { ...b, id }]);
    return id;
  };

  // —— 逐字"打字机"渲染：把上游每次的大块 delta 拆成小片，平滑追加 ——
  const pendingRef = useRef<Map<string, { buf: string; done: boolean }>>(new Map());
  const flushTimerRef = useRef<number | null>(null);

  const ensureFlushTimer = () => {
    if (flushTimerRef.current != null) return;
    flushTimerRef.current = window.setInterval(() => {
      const map = pendingRef.current;
      if (map.size === 0) {
        if (flushTimerRef.current != null) window.clearInterval(flushTimerRef.current);
        flushTimerRef.current = null;
        return;
      }
      setBubbles((prev) =>
        prev.map((b) => {
          const slot = map.get(b.id);
          if (!slot) return b;
          if (slot.buf.length === 0) {
            if (slot.done) {
              map.delete(b.id);
              return { ...b, streaming: false };
            }
            return b;
          }
          // 缓冲越大流速越快，避免落后太多；同时保证最低一次 2 字
          const take = Math.min(slot.buf.length, Math.max(2, Math.ceil(slot.buf.length / 12)));
          const chunk = slot.buf.slice(0, take);
          slot.buf = slot.buf.slice(take);
          const next: Bubble = { ...b, text: b.text + chunk };
          if (slot.buf.length === 0 && slot.done) {
            map.delete(b.id);
            next.streaming = false;
          }
          return next;
        }),
      );
    }, 24) as unknown as number;
  };

  useEffect(() => {
    return () => {
      if (flushTimerRef.current != null) {
        window.clearInterval(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, []);

  const appendDelta = (id: string, delta: string) => {
    if (!delta) return;
    const map = pendingRef.current;
    const slot = map.get(id) ?? { buf: "", done: false };
    slot.buf += delta;
    map.set(id, slot);
    ensureFlushTimer();
  };
  const finishBubble = (id: string) => {
    const map = pendingRef.current;
    const slot = map.get(id);
    if (slot) {
      slot.done = true;
      ensureFlushTimer();
    } else {
      setBubbles((prev) => prev.map((b) => (b.id === id ? { ...b, streaming: false } : b)));
    }
  };

  const errMsg = (e: string) => {
    if (e === "rate_limit") return t.script_pipeline_rate_limit;
    if (e === "no_credits") return t.script_pipeline_no_credits;
    if (e === "content_policy") return t.script_pipeline_content_policy;
    return `${t.script_pipeline_failed}: ${e}`;
  };

  // 通用：消费 async iterable 流（serverFn 直接返回的 AsyncIterable）
  async function consume(
    stream: AsyncIterable<StreamChunk>,
    bubbleId: string,
    onText: (text: string) => void,
  ): Promise<{ ok: boolean; text: string }> {
    let acc = "";
    try {
      for await (const chunk of stream) {
        if ("error" in chunk) {
          setError(errMsg(chunk.error));
          finishBubble(bubbleId);
          return { ok: false, text: acc };
        }
        if ("delta" in chunk) {
          acc += chunk.delta;
          appendDelta(bubbleId, chunk.delta);
        } else if ("done" in chunk) {
          if (chunk.text && chunk.text.length > acc.length) {
            const tail = chunk.text.slice(acc.length);
            if (tail) appendDelta(bubbleId, tail);
            acc = chunk.text;
          }
          onText(acc);
          finishBubble(bubbleId);
          return { ok: true, text: acc };
        }
      }
      // 流自然结束但未 yield done
      onText(acc);
      finishBubble(bubbleId);
      return { ok: true, text: acc };
    } catch (e) {
      setError(e instanceof Error ? e.message : t.sc_stream_failed);
      finishBubble(bubbleId);
      return { ok: false, text: acc };
    }
  }

  // ============ 阶段动作 ============

  const runSynopsis = async () => {
    if (!theme.trim() || !plot.trim()) return;
    setError(null);
    setLoading(true);
    setRefineCandidate("");
    setRefineHistory([]);
    const genreList = selectedTags.filter((t) => genres.some((g) => g.value === t));
    const toneList = selectedTags.filter((t) => tones.some((g) => g.value === t));
    pushBubble({
      role: "user",
      text: t.sc_inspiration_bubble
        .replace("{type}", type)
        .replace("{genres}", genreList.join("、"))
        .replace("{tones}", toneList.join("、"))
        .replace("{minutes}", String(totalMinutes))
        .replace("{theme}", theme)
        .replace("{plot}", plot)
        .replace("{eps}", String(expectedEpisodes)),
    });
    const id = pushBubble({ role: "agent", text: "", streaming: true, stage: "synopsis" });
    const stream = (await callSynopsis({
      data: {
        lang,
        type,
        genre: genreList.join("、"),
        tone: toneList.join("、"),
        theme,
        plot,
        expectedEpisodes,
        totalMinutes,
        model,
      },
    })) as AsyncIterable<StreamChunk>;
    const res = await consume(stream, id, (text) => {
      setSynopsisText(text);
      setSynopsisDraft(text);
    });
    setLoading(false);
    if (res.ok) {
      setStage("synopsis");
      setSynopsisVersions((prev) => [
        ...prev,
        {
          id: `v-${Date.now()}`,
          text: res.text,
          source: "ai-init",
          createdAt: new Date().toISOString(),
        },
      ]);
    }
  };

  // ===== 梗概精修：AI 对话修改 =====
  const runRefine = async () => {
    const instr = refineInstruction.trim();
    if (!instr || !synopsisDraft.trim() || refineStreaming) return;
    setError(null);
    setRefineStreaming(true);
    setRefineCandidate("");
    const userBubbleId = pushBubble({
      role: "user",
      text: t.sc_refine_instruction_bubble.replace("{instruction}", instr),
    });
    const id = pushBubble({ role: "agent", text: "", streaming: true, stage: "synopsis" });
    setRefineHistory((h) => [...h, { role: "user", text: instr }]);
    const stream = (await callRefine({
      data: {
        lang,
        currentSynopsis: synopsisDraft,
        instruction: instr,
        history: refineHistory.slice(-8).map((h) => ({ role: h.role, content: h.text })),
        model,
      },
    })) as AsyncIterable<StreamChunk>;
    const res = await consume(stream, id, (text) => setRefineCandidate(text));
    setRefineStreaming(false);
    if (res.ok) {
      setRefineHistory((h) => [...h, { role: "agent", text: t.sc_candidate_pending }]);
      setRefineInstruction("");
    } else {
      // 失败时移除占位
      setRefineHistory((h) => h.slice(0, -1));
    }
    void userBubbleId;
  };

  const acceptRefine = () => {
    if (!refineCandidate.trim()) return;
    setSynopsisVersions((prev) => [
      ...prev,
      {
        id: `v-${Date.now()}`,
        text: refineCandidate,
        source: "ai-refine",
        createdAt: new Date().toISOString(),
      },
    ]);
    setSynopsisDraft(refineCandidate);
    setSynopsisText(refineCandidate);
    setRefineCandidate("");
    pushBubble({ role: "system", text: t.sc_refine_accepted });
  };

  const discardRefine = () => {
    setRefineCandidate("");
    pushBubble({ role: "system", text: t.sc_refine_discarded });
  };

  const rollbackVersion = (vid: string) => {
    const v = synopsisVersions.find((x) => x.id === vid);
    if (!v) return;
    setSynopsisDraft(v.text);
    setSynopsisText(v.text);
    pushBubble({
      role: "system",
      text: t.sc_rollback_version.replace("{time}", new Date(v.createdAt).toLocaleString()),
    });
  };

  const runEpisode = async () => {
    // 用户最终确认的梗概以草稿为准
    const finalSynopsis = synopsisDraft.trim() || synopsisText;
    if (!finalSynopsis) return;
    if (finalSynopsis !== synopsisText) setSynopsisText(finalSynopsis);
    setError(null);
    setLoading(true);
    pushBubble({
      role: "user",
      text: t.sc_confirm_synopsis_bubble.replace("{count}", String(sceneCount)),
    });
    const id = pushBubble({ role: "agent", text: "", streaming: true, stage: "episode" });
    const stream = (await callEpisode({
      data: { lang, epIndex: 1, sceneCount, synopsisText: finalSynopsis, model },
    })) as AsyncIterable<StreamChunk>;
    const res = await consume(stream, id, (text) => {
      setEpisodes([{ epIndex: 1, text }]);
    });
    setLoading(false);
    if (res.ok) {
      setStage("episodes");
      setNextEpIndex(2);
      setTargetEpisode((v) => Math.max(v, Math.min(expectedEpisodes, 10)));
    }
  };

  // 多剧集：生成指定集（可被自动连跑复用，使用入参避免闭包陈旧）
  async function generateEpisode(opts: {
    epIndex: number;
    sceneCount: number;
    prevText: string;
    prevEpIndex: number | null;
  }): Promise<{ ok: boolean; text: string }> {
    pushBubble({
      role: "user",
      text: t.sc_generate_episode_bubble
        .replace("{n}", String(opts.epIndex))
        .replace("{count}", String(opts.sceneCount)),
    });
    const id = pushBubble({ role: "agent", text: "", streaming: true, stage: "episodes" });
    const contextSynopsis = opts.prevText
      ? `${synopsisText}\n\n${t.sc_prev_ep_ref.replace("{n}", String(opts.prevEpIndex))}\n${opts.prevText.slice(-2000)}`
      : synopsisText;
    const stream = (await callEpisode({
      data: {
        lang,
        epIndex: opts.epIndex,
        sceneCount: opts.sceneCount,
        synopsisText: contextSynopsis,
        expectedEpisodes,
        model,
      },
    })) as AsyncIterable<StreamChunk>;
    return consume(stream, id, (text) => {
      setEpisodes((prev) => {
        const others = prev.filter((e) => e.epIndex !== opts.epIndex);
        return [...others, { epIndex: opts.epIndex, text }].sort((a, b) => a.epIndex - b.epIndex);
      });
    });
  }

  const runNextEpisode = async () => {
    if (!synopsisText) return;
    setError(null);
    setLoading(true);
    const last = episodes[episodes.length - 1];
    const res = await generateEpisode({
      epIndex: nextEpIndex,
      sceneCount: nextSceneCount,
      prevText: last?.text ?? "",
      prevEpIndex: last?.epIndex ?? null,
    });
    setLoading(false);
    if (res.ok) setNextEpIndex(nextEpIndex + 1);
  };

  // 自动连续生成：从当前 nextEpIndex 一路生成到 targetEpisode
  const runUntilTarget = async () => {
    if (!synopsisText) return;
    const target = Math.max(nextEpIndex, Math.min(expectedEpisodes, targetEpisode));
    if (target < nextEpIndex) return;
    setError(null);
    setAutoRunning(true);
    setLoading(true);
    stopAutoRef.current = false;
    pushBubble({
      role: "system",
      text: t.sc_auto_start
        .replace("{from}", String(nextEpIndex))
        .replace("{to}", String(target))
        .replace("{count}", String(target - nextEpIndex + 1)),
    });
    let cur = nextEpIndex;
    let prevText = episodes[episodes.length - 1]?.text ?? "";
    let prevIdx: number | null = episodes[episodes.length - 1]?.epIndex ?? null;
    let generatedEpisodes = [...episodes];
    try {
      while (cur <= target) {
        if (stopAutoRef.current) {
          pushBubble({ role: "system", text: t.sc_auto_stopped.replace("{n}", String(cur - 1)) });
          break;
        }
        const res = await generateEpisode({
          epIndex: cur,
          sceneCount: nextSceneCount,
          prevText,
          prevEpIndex: prevIdx,
        });
        if (!res.ok) {
          pushBubble({ role: "system", text: t.sc_auto_failed.replace("{n}", String(cur)) });
          break;
        }
        generatedEpisodes = [
          ...generatedEpisodes.filter((e) => e.epIndex !== cur),
          { epIndex: cur, text: res.text },
        ].sort((a, b) => a.epIndex - b.epIndex);
        prevText = res.text;
        prevIdx = cur;
        setNextEpIndex(cur + 1);
        cur += 1;
        if ((cur - 1) % 3 === 0) void persist(false, generatedEpisodes);
      }
      if (cur > target && !stopAutoRef.current) {
        pushBubble({ role: "system", text: t.sc_auto_done.replace("{n}", String(target)) });
        void persist(false, generatedEpisodes);
      }
    } finally {
      setAutoRunning(false);
      setLoading(false);
    }
  };

  const stopAuto = () => {
    stopAutoRef.current = true;
  };

  // 中途保存 / 完成保存（可被多次调用，复用同一 id）
  const savedIdRef = useRef<string | null>(null);
  const persist = async (markDone: boolean, episodesSnapshot = episodes) => {
    const id = `scr-${Date.now()}`;
    const finalId = savedIdRef.current ?? id;
    savedIdRef.current = finalId;
    const titleMatch = synopsisText.match(/《([^》]+)》/);
    const title = titleMatch?.[1] ?? theme ?? t.sc_untitled;
    const existing = findScript(finalId);
    const item: SavedScript = {
      id: finalId,
      title,
      plot,
      type,
      genre: selectedTags.filter((t) => genres.some((g) => g.value === t)),
      tone: selectedTags.filter((t) => tones.some((g) => g.value === t)),
      model,
      synopsisText,
      episodesText: episodesSnapshot.length > 0 ? episodesSnapshot : undefined,
      expectedEpisodes,
      totalMinutes,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await upsertScriptAndCloud(item);
    onSaved?.();
    // Fire-and-forget cover generation. Doesn't block save; if a cover
    // already exists (re-save of same id) this is a no-op. onUpdate refreshes
    // the parent list so the new cover shows up without a manual reload.
    if (!item.coverUrl) {
      void ensureScriptCover({
        script: item,
        uploadCover: callUploadCover as any,
        onUpdate: () => onSaved?.(),
      });
    }
    if (markDone) setStage("done");
    pushBubble({
      role: "system",
      text: markDone
        ? t.sc_save_done.replace("{title}", title).replace("{count}", String(episodes.length))
        : t.sc_save_progress_bubble
            .replace("{title}", title)
            .replace("{count}", String(episodes.length)),
    });
    return finalId;
  };

  const reset = () => {
    setStage("setup");
    setSynopsisText("");
    setEpisodes([]);
    setNextEpIndex(2);
    savedIdRef.current = null;
    setBubbles([
      {
        id: "welcome",
        role: "agent",
        text: t.sc_welcome_reset,
      },
    ]);
    setError(null);
  };

  // ============ 渲染 ============

  const stageIdx = STAGES.indexOf(stage);

  return (
    <div className="panel p-5 sm:p-6 space-y-4">
      {/* 头部 + 阶段指示 */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold text-text-primary flex items-center gap-2">
          <Sparkles size={16} className="text-accent" />
          {t.sc_agent_title}
        </h2>
        <span className="text-xs text-text-muted">{t.sc_agent_subtitle}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {STAGES.map((s, i) => {
            const done = i < stageIdx;
            const active = i === stageIdx;
            return (
              <div key={s} className="flex items-center gap-1">
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] ${
                    active
                      ? "bg-accent text-bg-base font-medium"
                      : done
                        ? "bg-accent-dim text-accent"
                        : "bg-bg-elevated text-text-muted"
                  }`}
                >
                  {done ? <Check size={10} className="inline -mt-0.5" /> : null}{" "}
                  {(t as Record<string, string>)[STAGE_LABELS[s]]}
                </span>
                {i < STAGES.length - 1 && <ArrowRight size={10} className="text-text-muted" />}
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 text-sm px-3 py-2">
          {error}
        </div>
      )}

      {/* 聊天区 */}
      <div
        ref={scrollRef}
        className="rounded-xl border border-border bg-bg-base/40 max-h-[560px] min-h-[280px] overflow-y-auto p-3 space-y-3"
      >
        {bubbles.map((b) => (
          <ChatBubble key={b.id} bubble={b} />
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Loader2 size={12} className="animate-spin" />
            {t.sc_thinking}
          </div>
        )}
      </div>

      {/* 阶段输入栏 */}
      {stage === "setup" && (
        <SetupBar
          type={type}
          setType={setType}
          selectedTags={selectedTags}
          setSelectedTags={setSelectedTags}
          model={model}
          setModel={setModel}
          theme={theme}
          setTheme={setTheme}
          plot={plot}
          setPlot={setPlot}
          expectedEpisodes={expectedEpisodes}
          setExpectedEpisodes={setExpectedEpisodes}
          totalMinutes={totalMinutes}
          setTotalMinutes={setTotalMinutes}
          types={types}
          genres={genres}
          tones={tones}
          models={models}
          t={t}
          loading={loading}
          onSubmit={runSynopsis}
        />
      )}

      {stage === "synopsis" && (
        <SynopsisRefinePanel
          draft={synopsisDraft}
          setDraft={setSynopsisDraft}
          candidate={refineCandidate}
          streaming={refineStreaming}
          instruction={refineInstruction}
          setInstruction={setRefineInstruction}
          onRunRefine={runRefine}
          onAccept={acceptRefine}
          onDiscard={discardRefine}
          onRegenerate={runSynopsis}
          onConfirm={runEpisode}
          sceneCount={sceneCount}
          setSceneCount={setSceneCount}
          loading={loading}
          versions={synopsisVersions}
          onRollback={rollbackVersion}
        />
      )}

      {stage === "episode" && (
        <ActionBar>
          <button
            onClick={runEpisode}
            disabled={loading}
            className="btn-ghost text-xs disabled:opacity-40"
          >
            <RefreshCw size={12} /> {t.sc_rewrite_episode}
          </button>
          <button
            onClick={() => {
              setStage("episodes");
              setNextEpIndex(2);
              pushBubble({
                role: "system",
                text: t.sc_enter_episodes_stage,
              });
            }}
            disabled={loading || !synopsisText}
            className="btn-primary text-xs ml-auto disabled:opacity-40"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {t.sc_enter_episodes_btn}
          </button>
        </ActionBar>
      )}

      {stage === "episodes" && (
        <ActionBar>
          <span className="text-xs text-text-muted">
            {t.sc_episodes_progress
              .replace("{count}", String(episodes.length))
              .replace("{n}", String(nextEpIndex))}
          </span>
          <label className="text-xs text-text-muted ml-2">{t.sc_scene_count_label}</label>
          <NumberField
            value={nextSceneCount}
            min={5}
            max={30}
            fallback={15}
            onCommit={setNextSceneCount}
            className="w-16 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-2 py-1.5 focus:outline-none focus:border-accent/50"
          />
          <button
            onClick={runNextEpisode}
            disabled={loading || autoRunning}
            className="btn-primary text-xs disabled:opacity-40"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {t.sc_generate_ep_n.replace("{n}", String(nextEpIndex))}
          </button>
          <label className="text-xs text-text-muted ml-2">{t.sc_run_until}</label>
          <NumberField
            value={targetEpisode}
            min={1}
            max={expectedEpisodes}
            fallback={nextEpIndex}
            onCommit={setTargetEpisode}
            className="w-16 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-2 py-1.5 focus:outline-none focus:border-accent/50"
          />
          <span className="text-xs text-text-muted">
            {t.sc_total_eps_suffix.replace("{count}", String(expectedEpisodes))}
          </span>
          {autoRunning ? (
            <button onClick={stopAuto} className="btn-ghost text-xs text-red-300">
              <StopCircle size={12} /> {t.sc_stop}
            </button>
          ) : (
            <button
              onClick={runUntilTarget}
              disabled={loading || targetEpisode < nextEpIndex}
              className="btn-primary text-xs disabled:opacity-40"
            >
              <Sparkles size={12} /> {t.sc_auto_run}
            </button>
          )}
          <button
            onClick={() => void persist(false)}
            disabled={loading || autoRunning || episodes.length === 0}
            className="btn-ghost text-xs ml-auto disabled:opacity-40"
          >
            <Save size={12} /> {t.sc_save_progress}
          </button>
          <button
            onClick={async () => {
              const id = await persist(true);
              navigate({ to: "/scripts/$scriptId", params: { scriptId: id } });
            }}
            disabled={loading || autoRunning || episodes.length === 0}
            className="btn-primary text-xs disabled:opacity-40"
          >
            <Check size={13} /> {t.sc_finish_view}
          </button>
        </ActionBar>
      )}

      {(stage === "episodes" || stage === "done") && episodes.length > 0 && (
        <EpisodeEditor
          episodes={episodes as EpisodeItem[]}
          setEpisodes={setEpisodes as React.Dispatch<React.SetStateAction<EpisodeItem[]>>}
          onSaveSnapshot={() => void persist(false)}
        />
      )}

      {stage === "done" && (
        <div className="flex justify-center pt-2">
          <button onClick={reset} className="btn-ghost text-xs">
            <Sparkles size={12} /> {t.sc_start_new}
          </button>
        </div>
      )}
    </div>
  );
}

// ============ 子组件 ============

function ChatBubble({ bubble }: { bubble: Bubble }) {
  const isUser = bubble.role === "user";
  const isSystem = bubble.role === "system";
  if (isSystem) {
    return <div className="text-center text-xs text-text-muted py-1">{bubble.text}</div>;
  }
  const isAgent = bubble.role === "agent";
  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
          isUser ? "bg-accent/20 text-accent" : "bg-bg-elevated text-text-muted"
        }`}
      >
        {isUser ? <UserIcon size={13} /> : <Bot size={13} />}
      </div>
      <div
        className={`max-w-[88%] rounded-xl px-3 py-2 text-sm leading-relaxed break-words ${
          isUser
            ? "bg-accent text-bg-base"
            : "bg-bg-elevated/60 text-text-primary border border-border/60 prose prose-invert prose-sm max-w-none prose-headings:mt-3 prose-headings:mb-2 prose-p:my-2 prose-li:my-0.5 prose-strong:text-accent"
        }`}
      >
        {isAgent ? (
          bubble.text ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{bubble.text}</ReactMarkdown>
          ) : bubble.streaming ? (
            "…"
          ) : null
        ) : (
          <span className="whitespace-pre-wrap">{bubble.text}</span>
        )}
        {bubble.streaming && (
          <span className="inline-block w-1.5 h-3 ml-0.5 bg-accent animate-pulse align-middle" />
        )}
      </div>
    </div>
  );
}

function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border pt-3">
      {children}
    </div>
  );
}

// ============ 梗概精修面板（手动编辑 + AI 对话改写 + 版本回滚）============

const QUICK_REFINE_CHIPS = [
  "sc_chip_compact",
  "sc_chip_twist",
  "sc_chip_female",
  "sc_chip_reduce_30",
  "sc_chip_hooks",
  "sc_chip_personality",
];

function SynopsisRefinePanel(props: {
  draft: string;
  setDraft: (v: string) => void;
  candidate: string;
  streaming: boolean;
  instruction: string;
  setInstruction: (v: string) => void;
  onRunRefine: () => void;
  onAccept: () => void;
  onDiscard: () => void;
  onRegenerate: () => void;
  onConfirm: () => void;
  sceneCount: number;
  setSceneCount: (v: number) => void;
  loading: boolean;
  versions: {
    id: string;
    text: string;
    source: "ai-init" | "ai-refine" | "manual";
    createdAt: string;
  }[];
  onRollback: (id: string) => void;
}) {
  const { t } = useLanguage();
  const [showHistory, setShowHistory] = useState(false);
  const wordCount = props.draft.length;
  const canConfirm = !props.loading && !props.streaming && wordCount >= 200;
  return (
    <div className="pt-3 border-t border-border space-y-3">
      <div className="flex items-center gap-2">
        <Pencil size={14} className="text-accent" />
        <h3 className="font-semibold text-text-primary text-sm">{t.sc_refine_panel_title}</h3>
        <span className="text-xs text-text-muted">
          {t.sc_chars_versions
            .replace("{count}", String(wordCount))
            .replace("{versions}", String(props.versions.length))}
        </span>
        <button
          onClick={() => setShowHistory((v) => !v)}
          disabled={props.versions.length === 0}
          className="ml-auto btn-ghost text-xs disabled:opacity-40"
        >
          <History size={12} /> {t.sc_history}
        </button>
        <button
          onClick={props.onRegenerate}
          disabled={props.loading || props.streaming}
          className="btn-ghost text-xs disabled:opacity-40"
        >
          <RefreshCw size={12} /> {t.sc_regenerate}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* 左：可编辑梗概 */}
        <div className="rounded-xl border border-border bg-bg-base/40 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">{t.sc_draft_label}</span>
            <span className="text-[11px] text-text-muted">{t.sc_min_chars_hint}</span>
          </div>
          <textarea
            value={props.draft}
            onChange={(e) => props.setDraft(e.target.value)}
            rows={18}
            className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary p-3 leading-7 font-mono focus:outline-none focus:border-accent/50 resize-y min-h-[360px]"
            placeholder={t.sc_draft_placeholder}
          />
        </div>

        {/* 右：AI 精修对话 */}
        <div className="rounded-xl border border-border bg-bg-base/40 p-3 space-y-2 flex flex-col">
          <div className="text-xs text-text-muted flex items-center gap-2">
            <Bot size={12} /> {t.sc_refine_assistant}
          </div>

          {/* 候选区 */}
          {(props.candidate || props.streaming) && (
            <div className="rounded-lg border border-accent/40 bg-accent/5 p-2 space-y-2">
              <div className="text-[11px] text-accent flex items-center gap-1">
                <Sparkles size={11} />{" "}
                {props.streaming ? t.sc_candidate_streaming : t.sc_candidate_pending_adopt}
              </div>
              <div className="max-h-[200px] overflow-y-auto rounded bg-bg-base/60 p-2 text-xs text-text-primary whitespace-pre-wrap leading-6">
                {props.candidate || "…"}
                {props.streaming && (
                  <span className="inline-block w-1.5 h-3 ml-0.5 bg-accent animate-pulse align-middle" />
                )}
              </div>
              {!props.streaming && props.candidate && (
                <div className="flex gap-2 justify-end">
                  <button onClick={props.onDiscard} className="btn-ghost text-xs">
                    {t.sc_discard}
                  </button>
                  <button onClick={props.onAccept} className="btn-primary text-xs">
                    <Check size={12} /> {t.sc_adopt}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 快捷指令 */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REFINE_CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => props.setInstruction((t as Record<string, string>)[c])}
                disabled={props.streaming}
                className="text-[11px] px-2 py-0.5 rounded-full bg-bg-elevated border border-border text-text-muted hover:border-accent/40 hover:text-text-primary disabled:opacity-40"
              >
                {(t as Record<string, string>)[c]}
              </button>
            ))}
          </div>

          <textarea
            value={props.instruction}
            onChange={(e) => props.setInstruction(e.target.value)}
            rows={3}
            disabled={props.streaming}
            placeholder={t.sc_refine_instruction_placeholder}
            className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary p-2 focus:outline-none focus:border-accent/50 placeholder:text-text-muted disabled:opacity-60 resize-none"
          />
          <div className="flex justify-end">
            <button
              onClick={props.onRunRefine}
              disabled={props.streaming || !props.instruction.trim() || !props.draft.trim()}
              className="btn-primary text-xs disabled:opacity-40"
            >
              {props.streaming ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Send size={12} />
              )}
              {props.streaming ? t.sc_generating : t.sc_ai_modify}
            </button>
          </div>
        </div>
      </div>

      {/* 历史版本 */}
      {showHistory && props.versions.length > 0 && (
        <div className="rounded-xl border border-border bg-bg-base/40 p-3">
          <div className="text-xs text-text-muted mb-2">{t.sc_history_versions}</div>
          <ul className="space-y-1">
            {props.versions.map((v) => (
              <li
                key={v.id}
                className="flex items-center gap-2 text-xs rounded-md px-2 py-1 hover:bg-bg-elevated/60"
              >
                <span className="text-text-primary font-medium">
                  {v.source === "ai-init"
                    ? t.sc_source_first
                    : v.source === "ai-refine"
                      ? t.sc_source_refine
                      : t.sc_source_manual}
                </span>
                <span className="text-text-muted">{new Date(v.createdAt).toLocaleString()}</span>
                <span className="text-text-muted/70">
                  {t.sc_chars_n.replace("{count}", String(v.text.length))}
                </span>
                <button
                  onClick={() => props.onRollback(v.id)}
                  className="ml-auto inline-flex items-center gap-1 text-accent hover:underline"
                >
                  <RotateCcw size={11} /> {t.sc_rollback}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 确认栏 */}
      <ActionBar>
        <label className="text-xs text-text-muted">{t.sc_ep1_scene_count}</label>
        <NumberField
          value={props.sceneCount}
          min={5}
          max={30}
          fallback={15}
          onCommit={props.setSceneCount}
          className="w-20 rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-2 py-1.5 focus:outline-none focus:border-accent/50"
        />
        <span className="text-xs text-text-muted ml-auto">
          {wordCount < 200
            ? t.sc_need_more_chars.replace("{count}", String(200 - wordCount))
            : t.sc_synopsis_ready}
        </span>
        <button
          onClick={props.onConfirm}
          disabled={!canConfirm}
          className="btn-primary text-xs disabled:opacity-40"
        >
          {props.loading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}✅
          {t.sc_confirm_synopsis}
        </button>
      </ActionBar>
    </div>
  );
}

// ============ 分集编辑器 ============

type EpisodeVersion = { text: string; savedAt: string; label?: string };
type EpisodeItem = { epIndex: number; text: string; versions?: EpisodeVersion[] };

function EpisodeEditor({
  episodes,
  setEpisodes,
  onSaveSnapshot,
}: {
  episodes: EpisodeItem[];
  setEpisodes: React.Dispatch<React.SetStateAction<EpisodeItem[]>>;
  onSaveSnapshot: () => void;
}) {
  const { t } = useLanguage();
  const [focusedEp, setFocusedEp] = useState<number>(episodes[0]?.epIndex ?? 1);
  const [collapsedList, setCollapsedList] = useState<Set<number>>(new Set());

  const toggleCollapsed = (idx: number) => {
    setCollapsedList((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  return (
    <div className="space-y-3 pt-3 border-t border-border">
      <div className="flex items-center gap-2">
        <Pencil size={14} className="text-accent" />
        <h3 className="font-semibold text-text-primary text-sm">{t.sc_episode_editor_title}</h3>
        <span className="text-xs text-text-muted">
          {t.sc_episodes_count_versions.replace("{count}", String(episodes.length))}
        </span>
        {/* 快速跳转下拉框 */}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-text-muted">
          <span>{t.sc_jump_to}</span>
          <select
            value={focusedEp}
            onChange={(e) => setFocusedEp(Number(e.target.value))}
            className="rounded-md bg-bg-elevated border border-border text-text-primary text-xs px-2 py-1 focus:outline-none focus:border-accent/50"
          >
            {episodes.map((ep) => (
              <option key={ep.epIndex} value={ep.epIndex}>
                {t.sc_episode_n.replace("{n}", String(ep.epIndex))}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="space-y-3">
        {episodes.map((ep) => {
          const isFocused = ep.epIndex === focusedEp;
          const isCollapsed = collapsedList.has(ep.epIndex);
          return (
            <div key={ep.epIndex}>
              {/* 小卡片：未聚焦时显示简要信息，点击跳转 */}
              {!isFocused && (
                <div
                  className="rounded-xl border border-border bg-bg-base/40 px-3 py-2 flex items-center gap-3 cursor-pointer hover:border-accent/50 transition-colors"
                  onClick={() => setFocusedEp(ep.epIndex)}
                  title={t.sc_click_jump_episode}
                >
                  <span className="text-sm font-semibold text-text-primary">
                    {t.sc_episode_n.replace("{n}", String(ep.epIndex))}
                  </span>
                  <span className="text-xs text-text-muted truncate flex-1 min-w-0">
                    {ep.text
                      .slice(0, 60)
                      .replace(/[#*`>_\-]/g, "")
                      .replace(/\s+/g, " ")
                      .trim() || t.sc_empty}
                  </span>
                  <span className="text-[11px] text-text-muted shrink-0">
                    {t.sc_chars_n.replace("{count}", String(ep.text.length))}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapsed(ep.epIndex);
                    }}
                    className="text-text-muted hover:text-text-primary shrink-0"
                    title={isCollapsed ? t.sc_expand : t.sc_collapse}
                  >
                    {isCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                  </button>
                </div>
              )}
              {/* 完整编辑卡片：聚焦时显示 */}
              {isFocused && (
                <EpisodeCard
                  ep={ep}
                  onChange={(text) =>
                    setEpisodes((prev) =>
                      prev.map((e) => (e.epIndex === ep.epIndex ? { ...e, text } : e)),
                    )
                  }
                  onSaveVersion={(label) => {
                    setEpisodes((prev) =>
                      prev.map((e) => {
                        if (e.epIndex !== ep.epIndex) return e;
                        const versions = e.versions ? [...e.versions] : [];
                        versions.unshift({
                          text: e.text,
                          savedAt: new Date().toISOString(),
                          label: label || `v${versions.length + 1}`,
                        });
                        return { ...e, versions };
                      }),
                    );
                    setTimeout(onSaveSnapshot, 0);
                  }}
                  onRevert={(versionIndex) => {
                    setEpisodes((prev) =>
                      prev.map((e) => {
                        if (e.epIndex !== ep.epIndex) return e;
                        const v = e.versions?.[versionIndex];
                        if (!v) return e;
                        return { ...e, text: v.text };
                      }),
                    );
                  }}
                  onCollapse={() => setFocusedEp(-1)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EpisodeCard({
  ep,
  onChange,
  onSaveVersion,
  onRevert,
  onCollapse,
}: {
  ep: EpisodeItem;
  onChange: (text: string) => void;
  onSaveVersion: (label?: string) => void;
  onRevert: (versionIndex: number) => void;
  onCollapse?: () => void;
}) {
  const { t } = useLanguage();
  const [showHistory, setShowHistory] = useState(false);
  const [versionLabel, setVersionLabel] = useState("");
  return (
    <div className="rounded-xl border border-border bg-bg-base/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-text-primary">
          {t.sc_episode_n.replace("{n}", String(ep.epIndex))}
        </span>
        <span className="text-[11px] text-text-muted">
          {t.sc_chars_versions
            .replace("{count}", String(ep.text.length))
            .replace("{versions}", String(ep.versions?.length ?? 0))}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {onCollapse && (
            <button onClick={onCollapse} className="btn-ghost text-xs" title={t.sc_collapse}>
              <ChevronUp size={12} /> {t.sc_collapse}
            </button>
          )}
          <input
            value={versionLabel}
            onChange={(e) => setVersionLabel(e.target.value)}
            placeholder={t.sc_version_label_placeholder}
            className="w-36 rounded-md bg-bg-elevated border border-border text-xs text-text-primary px-2 py-1 focus:outline-none focus:border-accent/50 placeholder:text-text-muted"
          />
          <button
            onClick={() => {
              onSaveVersion(versionLabel.trim() || undefined);
              setVersionLabel("");
            }}
            className="btn-primary text-xs"
          >
            <Save size={12} /> {t.sc_save_version}
          </button>
          <button
            onClick={() => setShowHistory((v) => !v)}
            disabled={!ep.versions?.length}
            className="btn-ghost text-xs disabled:opacity-40"
          >
            <History size={12} /> {t.sc_history}
          </button>
        </div>
      </div>
      <textarea
        value={ep.text}
        onChange={(e) => onChange(e.target.value)}
        rows={12}
        className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary p-3 leading-7 font-mono focus:outline-none focus:border-accent/50 resize-y min-h-[200px]"
      />
      {showHistory && ep.versions && ep.versions.length > 0 && (
        <ul className="space-y-1 pt-1 border-t border-border">
          {ep.versions.map((v, i) => (
            <li
              key={i}
              className="flex items-center gap-2 text-xs text-text-muted rounded-md px-2 py-1 hover:bg-bg-elevated/60"
            >
              <span className="text-text-primary font-medium">
                {v.label ?? `v${ep.versions!.length - i}`}
              </span>
              <span>{new Date(v.savedAt).toLocaleString()}</span>
              <span className="text-text-muted/70">
                {t.sc_chars_n.replace("{count}", String(v.text.length))}
              </span>
              <button
                onClick={() => onRevert(i)}
                className="ml-auto inline-flex items-center gap-1 text-accent hover:underline"
              >
                <RotateCcw size={11} /> {t.sc_rollback_to_version}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SetupBar(props: {
  type: string;
  setType: (v: string) => void;
  selectedTags: string[];
  setSelectedTags: (v: string[]) => void;
  model: string;
  setModel: (v: string) => void;
  theme: string;
  setTheme: (v: string) => void;
  plot: string;
  setPlot: (v: string) => void;
  expectedEpisodes: number;
  setExpectedEpisodes: (v: number) => void;
  totalMinutes: number;
  setTotalMinutes: (v: number) => void;
  types: Props["types"];
  genres: Props["genres"];
  tones: Props["tones"];
  models: Props["models"];
  t: ReturnType<typeof useLanguage>["t"];
  loading: boolean;
  onSubmit: () => void;
}) {
  const { t } = props;
  const [lockModal, setLockModal] = useState<string | null>(null);
  const allTags: TagOption[] = [
    ...props.genres.map((g) => ({
      value: g.value,
      label: g.locked && g.label ? (t as Record<string, string>)[g.label] : (t[g.key] as string),
      group: "genre" as const,
      locked: g.locked,
    })),
    ...props.tones.map((g) => ({
      value: g.value,
      label: t[g.key] as string,
      group: "tone" as const,
    })),
  ];
  const toggleTag = (value: string) => {
    if (props.selectedTags.includes(value)) {
      props.setSelectedTags(props.selectedTags.filter((v) => v !== value));
    } else {
      props.setSelectedTags([...props.selectedTags, value]);
    }
  };
  return (
    <div className="space-y-3 pt-1">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SelectField
          label={t.script_type}
          value={props.type}
          onChange={props.setType}
          options={props.types.map((x) => ({ value: x.value, label: t[x.key] as string }))}
        />
        {/* 合并后的题材+风格多选 */}
        <div className="col-span-2">
          <label className="text-xs text-text-muted mb-1 block">{t.sc_genre_tone_multi}</label>
          <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-bg-elevated border border-border min-h-[42px]">
            {allTags.map((tag) => {
              const selected = props.selectedTags.includes(tag.value);
              if (tag.locked) {
                return (
                  <button
                    key={tag.value}
                    type="button"
                    onClick={() => setLockModal(tag.label)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors bg-bg-base border-border text-text-muted hover:border-rose-500/50 hover:text-rose-400"
                  >
                    🔒 {tag.label}
                  </button>
                );
              }
              return (
                <button
                  key={tag.value}
                  type="button"
                  onClick={() => toggleTag(tag.value)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                    selected
                      ? "bg-accent/20 border-accent text-accent"
                      : "bg-bg-base border-border text-text-muted hover:border-accent/40"
                  }`}
                >
                  {selected && (
                    <span className="text-[10px] opacity-60">
                      {tag.group === "genre" ? t.sc_genre_label : t.sc_tone_label}
                    </span>
                  )}
                  {tag.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="text-xs text-text-muted mb-1 block">{t.sc_expected_episodes}</label>
          <NumberField
            value={props.expectedEpisodes}
            min={1}
            max={200}
            fallback={100}
            onCommit={props.setExpectedEpisodes}
            className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-2 py-2 focus:outline-none focus:border-accent/50"
          />
        </div>
      </div>
      {/* 总时长 */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-text-muted mb-1 block">{t.sc_total_minutes}</label>
          <NumberField
            value={props.totalMinutes}
            min={5}
            max={600}
            fallback={90}
            onCommit={props.setTotalMinutes}
            className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-2 py-2 focus:outline-none focus:border-accent/50"
          />
        </div>
        <SelectField
          label={t.script_model}
          value={props.model}
          onChange={props.setModel}
          options={props.models.map((m) => ({ value: m.id, label: m.label }))}
        />
      </div>
      <div>
        <label className="text-xs text-text-muted mb-1 block">{t.script_theme}</label>
        <input
          value={props.theme}
          onChange={(e) => props.setTheme(e.target.value)}
          placeholder={t.sc_theme_placeholder}
          className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-3 py-2 focus:outline-none focus:border-accent/50 placeholder:text-text-muted"
        />
      </div>
      <div>
        <label className="text-xs text-text-muted mb-1 block">{t.script_plot}</label>
        <textarea
          value={props.plot}
          onChange={(e) => props.setPlot(e.target.value)}
          rows={3}
          placeholder={t.sc_plot_placeholder}
          className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary p-3 resize-none focus:outline-none focus:border-accent/50 placeholder:text-text-muted"
        />
      </div>
      <button
        onClick={props.onSubmit}
        disabled={props.loading || !props.theme.trim() || !props.plot.trim()}
        className="w-full btn-primary justify-center disabled:opacity-40"
      >
        {props.loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
        {t.sc_generate_synopsis}
      </button>

      {/* Locked genre modal */}
      {lockModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLockModal(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative bg-bg-surface border border-border rounded-2xl overflow-hidden max-w-sm w-full shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setLockModal(null)}
              className="absolute top-3 right-3 p-1 rounded-md hover:bg-bg-elevated text-text-muted"
            >
              <X size={16} />
            </button>
            <div className="text-center space-y-2">
              <div className="text-4xl">🔒</div>
              <h3 className="font-display text-lg font-bold text-text-primary">
                {t.sc_genre_unlock_title}
              </h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                {t.sc_genre_unlock_desc.replace("{name}", lockModal)}
              </p>
            </div>
            <button
              onClick={() => setLockModal(null)}
              className="w-full py-2.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold hover:opacity-90 transition"
            >
              {t.sc_got_it}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="text-xs text-text-muted mb-1 block">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-bg-elevated border border-border text-sm text-text-primary px-2 py-2 focus:outline-none focus:border-accent/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ============ 数字输入框（修复边输边 clamp / 清空跳默认值 bug）============
function NumberField({
  value,
  min,
  max,
  fallback,
  onCommit,
  className,
}: {
  value: number;
  min: number;
  max: number;
  fallback?: number;
  onCommit: (v: number) => void;
  className?: string;
}) {
  const [text, setText] = useState<string>(String(value));
  // 外部 value 变化时（如自动连跑推进 nextEpIndex）同步
  useEffect(() => {
    setText(String(value));
  }, [value]);
  const commit = () => {
    if (text === "" || text === "-") {
      const v = fallback ?? value;
      setText(String(v));
      if (v !== value) onCommit(v);
      return;
    }
    const n = Number(text);
    if (!Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, Math.floor(n)));
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={text}
      onChange={(e) => {
        const v = e.target.value;
        // 允许空串与纯数字，编辑过程中不 clamp，避免无法输入 10/20 等
        if (v === "" || /^\d+$/.test(v)) setText(v);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={className}
    />
  );
}
