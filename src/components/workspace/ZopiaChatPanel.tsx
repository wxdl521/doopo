import { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Plus,
  Send,
  ChevronDown,
  X,
  Check,
  PanelRightClose,
  PanelRightOpen,
  ChevronUp,
  Paperclip,
  FileIcon,
  FileText,
  Sparkles,
  Upload,
  Loader2,
  AlertTriangle,
  Video,
  AtSign,
} from "lucide-react";
import { useLanguage } from "../../i18n/LanguageContext";
import type { WorkspaceTab } from "./WorkspaceTopbar";
import {
  parseImportedScript,
  type ImportedScriptResult,
  type ParseStreamEvent,
} from "../../lib/parseImportedScript.functions";
import {
  planWorkspaceAgentAction,
  type WorkspaceAgentPlan,
} from "../../lib/workspaceAgent.functions";

type Attachment = { id: string; name: string; size: number; type: string; url?: string };

type CtaKey =
  | "extract"
  | "design"
  | "storyboard"
  | "enter_storyboard"
  | "to_script"
  | "to_character"
  | "to_timeline"
  | "refine"
  | "preview"
  | "generate_script"
  | "script_continue"
  | "script_episode"
  | "script_next"
  | "select_episodes"
  | "episode_modify";

// ============= localStorage persistence =============
// chat 历史落盘 —— 之前 messages 只在 React state 里,刷新页面 / 切 tab /
// 切工作空间就全没了。这里按 workspaceId 隔离,只剥掉 session-only 的
// attachment.url(URL.createObjectURL 在新页面就失效,留着会渲染 broken image)。
const CHAT_STORAGE_PREFIX = "doopoo-workspace-chat:";
const chatStorageKey = (workspaceId: string) => `${CHAT_STORAGE_PREFIX}${workspaceId}`;

function loadStoredMessages(workspaceId: string): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(chatStorageKey(workspaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Message[];
  } catch {
    // 解析失败 / SSR / 隐私模式 —— 都按"无历史"处理,别 throw 阻塞 UI。
    return [];
  }
}

function saveStoredMessages(workspaceId: string, messages: Message[]) {
  if (typeof window === "undefined") return;
  try {
    // 剥掉 attachment.url:由 URL.createObjectURL 创建,新会话就 404,
    // 落盘会污染历史图片。
    // 2026/07:video_confirm 的 pending/generating 状态刷新后不可恢复
    // (父组件上下文可能已变),重置为 cancelled,保留 prompt+图片供回看。
    const sanitized = messages.map((m) => {
      if (m.kind === "user" && m.attachments) {
        return {
          ...m,
          attachments: m.attachments.map(({ url: _url, ...rest }) => rest),
        };
      }
      if (m.kind === "video_confirm" && (m.status === "pending" || m.status === "generating")) {
        return { ...m, status: "cancelled" as const };
      }
      return m;
    });
    window.localStorage.setItem(chatStorageKey(workspaceId), JSON.stringify(sanitized));
  } catch {
    // 配额超限 / 隐私模式 / 序列化失败 —— 静默吞掉,UI 仍可用。
  }
}

function clearStoredMessages(workspaceId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(chatStorageKey(workspaceId));
  } catch {
    // ignore
  }
}

type Message =
  | { id: string; kind: "user"; text: string; attachments?: Attachment[] }
  | { id: string; kind: "agent_thought"; text: string; pending: boolean }
  | {
      id: string;
      kind: "workflow";
      steps: string[];
      doneCount: number;
      /** 2026/06:记录此 workflow 对应的 stage,用于点击步骤时跳转到对应 tab */
      stage?: WorkspaceTab;
      summary?: { title: string; detail: string; next: string };
      ctas?: { key: CtaKey; label: string; target: WorkspaceTab }[];
    }
  | {
      id: string;
      kind: "video_confirm";
      groupId: string;
      method: "shots" | "storyboard";
      title: string;
      previewPrompt: string;
      /** 卡片展示的参考图(带 label:首帧/尾帧/分镜图N/故事板/人物·名/场景·名/道具·名) */
      images: { url: string; label: string }[];
      extra?: Record<string, string>;
      /** 2026/07:本组角色的参考音频候选,供用户在卡片上手选一段传给 Seedance */
      audioCandidates?: { characterId: string; characterName: string; audioUrl: string }[];
      /** 2026/07:用户选中的参考音频 URL;"" 或 undefined = 不使用 */
      selectedAudioUrl?: string;
      /** pending=待确认 / generating=生成中 / done=已生成 / failed=失败可重试 / cancelled=已取消 */
      status: "pending" | "generating" | "done" | "failed" | "cancelled";
    }
  | {
      id: string;
      kind: "agent_plan";
      plan: WorkspaceAgentPlan;
      status: "pending" | "executing" | "done" | "cancelled";
      result?: string;
    };
type WorkflowDef = {
  steps: string[];
  summary: { title: string; detail: string; next: string };
  ctas: { key: CtaKey; label: string; target: WorkspaceTab }[];
};

function buildWorkflow(stage: WorkspaceTab, t: any): WorkflowDef {
  switch (stage) {
    case "canvas":
      return {
        steps: [
          t.zp_step_canvas_load,
          t.zp_step_canvas_expand,
          t.zp_step_canvas_outline,
          t.zp_step_canvas_chars,
        ],
        summary: {
          title: t.zp_summary_canvas_done,
          detail: t.zp_summary_canvas_detail,
          next: t.zp_summary_canvas_next,
        },
        ctas: [{ key: "generate_script", label: t.zp_cta_generate_script, target: "script" }],
      };
    case "character":
      return {
        steps: [
          t.zp_step_char_load,
          t.zp_step_char_parse,
          t.zp_step_char_extract,
          t.zp_step_char_persona,
        ],
        summary: {
          title: t.zp_summary_char_done,
          detail: t.zp_summary_char_detail,
          next: t.zp_summary_char_next,
        },
        ctas: [{ key: "enter_storyboard", label: t.zp_cta_enter_storyboard, target: "storyboard" }],
      };
    case "storyboard":
      return {
        steps: [
          t.zp_step_sb_load,
          t.zp_step_sb_parse,
          t.zp_step_sb_plan,
          t.zp_step_sb_compose,
          t.zp_step_sb_render,
        ],
        summary: {
          title: t.zp_summary_sb_done,
          detail: t.zp_summary_sb_detail,
          next: t.zp_summary_sb_next,
        },
        ctas: [
          { key: "to_timeline", label: t.zp_cta_to_timeline, target: "timeline" },
          { key: "refine", label: t.zp_cta_refine, target: "storyboard" },
        ],
      };
    case "timeline":
      return {
        steps: [
          t.zp_step_tl_load,
          t.zp_step_tl_align,
          t.zp_step_tl_audio,
          t.zp_step_tl_transition,
          t.zp_step_tl_preview,
        ],
        summary: {
          title: t.zp_summary_tl_done,
          detail: t.zp_summary_tl_detail,
          next: t.zp_summary_tl_next,
        },
        ctas: [
          { key: "preview", label: t.zp_cta_preview, target: "timeline" },
          { key: "refine", label: t.zp_cta_refine, target: "timeline" },
        ],
      };
    case "script":
      return {
        steps: [
          t.zp_step_load_workflow,
          t.zp_step_load_spec,
          t.zp_step_query_tools,
          t.zp_step_check_prev,
          t.zp_step_write_script,
        ],
        summary: { title: t.zp_summary_done, detail: t.zp_summary_detail, next: t.zp_summary_next },
        ctas: [
          { key: "script_next", label: t.zp_cta_script_next, target: "script" },
          { key: "script_continue", label: t.zp_cta_script_continue, target: "script" },
          { key: "script_episode", label: t.zp_cta_script_episode, target: "script" },
          { key: "select_episodes", label: t.zp_cta_select_episodes, target: "episodes" },
          { key: "extract", label: t.zp_cta_extract, target: "character" },
        ],
      };
    case "episodes":
      return {
        steps: [
          t.zp_step_episodes_load,
          t.zp_step_episodes_preview,
          t.zp_step_episodes_pacing,
          t.zp_step_episodes_extract,
          t.zp_step_episodes_next,
        ],
        summary: {
          title: t.zp_summary_episodes_done,
          detail: t.zp_summary_episodes_detail,
          next: t.zp_summary_episodes_next,
        },
        ctas: [
          { key: "episode_modify", label: t.zp_cta_episode_modify, target: "episodes" },
          { key: "extract", label: t.zp_cta_extract, target: "character" },
        ],
      };
    default:
      return {
        steps: [
          t.zp_step_load_workflow,
          t.zp_step_load_spec,
          t.zp_step_query_tools,
          t.zp_step_check_prev,
          t.zp_step_write_script,
        ],
        summary: { title: t.zp_summary_done, detail: t.zp_summary_detail, next: t.zp_summary_next },
        ctas: [
          { key: "script_next", label: t.zp_cta_script_next, target: "script" },
          { key: "script_continue", label: t.zp_cta_script_continue, target: "script" },
          { key: "script_episode", label: t.zp_cta_script_episode, target: "script" },
          { key: "select_episodes", label: t.zp_cta_select_episodes, target: "episodes" },
        ],
      };
  }
}

export type ZopiaChatPanelHandle = {
  triggerWorkflow: (
    targetStage: WorkspaceTab,
    awaitable: () => unknown | Promise<unknown>,
    opts?: { jumpAfter?: boolean; userMsg?: string },
  ) => void;
  /**
   * 2026/06:在对话框添加一条引用卡片(小图+名称),并预填底部输入框。
   * 用户直接在底部输入框输入修改意见发送。
   * 用于角色/场景/道具卡片"修改"按钮。
   */
  setPendingRef: (
    refType: "character" | "scene" | "prop",
    refId: string,
    label: string,
    imageUrl: string,
    lookId?: string | null,
  ) => void;
  /**
   * 2026/07:推一条"视频生成确认卡片"到对话框。
   * 分镜阶段点"生成视频"不再直接生成,而是把 prompt + 参考图 + 确认按钮
   * 以卡片形式展示在对话框里,用户点"确认生成"后才真正调用 onConfirmVideoGen。
   * 卡片只读(prompt/参考图不可编辑),确认时父组件重新 build payload 生成。
   */
  pushVideoConfirmCard: (payload: {
    groupId: string;
    method: "shots" | "storyboard";
    title: string;
    previewPrompt: string;
    images: { url: string; label: string }[];
    extra?: Record<string, string>;
    audioCandidates?: { characterId: string; characterName: string; audioUrl: string }[];
  }) => void;
};

const ZopiaChatPanel = forwardRef<
  ZopiaChatPanelHandle,
  {
    workspaceId: string;
    stage: WorkspaceTab;
    onJumpStage: (t: WorkspaceTab) => void;
    onProduce?: (t: WorkspaceTab, userPrompt?: string) => void | Promise<void> | Promise<unknown>;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    initialInput?: string;
    locked?: boolean;
    selectedEpisodeIndex?: number;
    episodeCount?: number;
    onImportScript?: (result: ImportedScriptResult) => void;
    streaming?: boolean;
    onEnterStoryboard?: () => void | Promise<void>;
    enterTimelineSignal?: number;
    onEnterTimeline?: () => void | Promise<void>;
    onModifyReference?: (
      refType: "character" | "scene" | "prop",
      refId: string,
      instruction: string,
      lookId?: string | null,
      /** 2026/07:主视图(要改的那张)URL,角色重生多图参考的图1。仅 character 用。 */
      mainViewUrl?: string,
    ) => void;
    /**
     * 2026/07:视频确认卡片点"确认生成"时调用,返回 Promise<boolean>。
     * true=生成成功(卡片变 done),false=失败(卡片变 failed,可重试)。
     * 父组件内部重新 build payload 并调 callGenVideo。
     */
    onConfirmVideoGen?: (
      groupId: string,
      method: "shots" | "storyboard",
      editedPreviewPrompt: string,
      selectedAudioUrl?: string,
    ) => Promise<boolean>;
    /**
     * 2026/07:视频确认卡片 generating 时点"中止生成"调用。
     * 父组件清 groupVideos 的 running + 设取消标记(防止事后 callGenVideo
     * resolve 又写状态)。卡片自身把 status 改回 pending(可重试)。
     */
    onCancelVideoGen?: (groupId: string) => void;
    /** 由工作区执行已规划且已确认的 Agent 动作。 */
    onExecuteAgentAction?: (plan: WorkspaceAgentPlan) => Promise<{ summary?: string } | void>;
    agentContext?: { characterCount: number; storyboardGroupCount: number; hasSynopsis: boolean };
  }
>(function ZopiaChatPanel(
  {
    workspaceId,
    stage,
    onJumpStage,
    onProduce,
    collapsed,
    onToggleCollapsed,
    initialInput,
    locked,
    selectedEpisodeIndex,
    episodeCount,
    onImportScript,
    streaming,
    onEnterStoryboard,
    enterTimelineSignal,
    onEnterTimeline,
    onModifyReference,
    onConfirmVideoGen,
    onCancelVideoGen,
    onExecuteAgentAction,
    agentContext,
  },
  ref: React.Ref<ZopiaChatPanelHandle>,
) {
  const { t, lang } = useLanguage();
  const callParseScript = useServerFn(parseImportedScript);
  const callPlanAgentAction = useServerFn(planWorkspaceAgentAction);
  // 优先用 localStorage 的历史(每个 workspace 一份)初始化,这样刷新
  // 页面 / 重新进入 workspace 时对话记录还在。读取失败 / SSR 退化为空。
  const [messages, setMessages] = useState<Message[]>(() => loadStoredMessages(workspaceId));
  const [input, setInput] = useState("");
  const [skipCreditConfirmation, setSkipCreditConfirmation] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(`doopoo:agent-skip-credit-confirm:${workspaceId}`) === "true";
  });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showUpgrade, setShowUpgrade] = useState(true);
  const [ctasCollapsed, setCtasCollapsed] = useState(false);
  // ParamField/ParamSpec 必须定义在 useState 之前 —— forward reference 对 type
  // alias 在 TS 里 OK,但 pendingCta 的 fields 之前是内联窄类型,推不出
  // multiSelect / locked / custom 这些可选字段,触发 TS2339。改成显式
  // ParamField[] 一次性解决。
  type ParamField = {
    key: string;
    label: string;
    options: { value: string; label: string; locked?: boolean }[];
    default: string;
    multiSelect?: boolean;
    custom?: boolean;
  };
  type ParamSpec = {
    baseText: string;
    targetStage: WorkspaceTab;
    jumpAfter: boolean;
    fields: ParamField[];
  };
  const [pendingCta, setPendingCta] = useState<null | {
    cta: { key: CtaKey; label: string; target: WorkspaceTab };
    spec: {
      baseText: string;
      targetStage: WorkspaceTab;
      jumpAfter: boolean;
      fields: ParamField[];
    };
    // values:对于 multiSelect 字段是 string[],其余是 string
    values: Record<string, string | string[]>;
    previewing: boolean;
  }>(null);
  const [episodeEditMode, setEpisodeEditMode] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [synopsisEditMode, setSynopsisEditMode] = useState(false);
  // 2026/06:待发送的引用修改信息,设置后预填输入框,发送时带引用上下文
  const [pendingRef, setPendingRef] = useState<{
    refType: "character" | "scene" | "prop";
    refId: string;
    label: string;
    imageUrl: string;
    lookId?: string | null;
  } | null>(null);
  const [pendingReferenceCost, setPendingReferenceCost] = useState<{
    ref: NonNullable<typeof pendingRef>;
    instruction: string;
  } | null>(null);
  const [lockModal, setLockModal] = useState<string | null>(null);
  // Import script modal state
  const [importModal, setImportModal] = useState<
    | null
    | { stage: "paste"; text: string; fileName: string | null }
    | { stage: "parsing"; progress: string }
    | { stage: "error"; message: string }
  >(null);
  const [importDragging, setImportDragging] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  // 2026/07:参考图 lightbox —— 点确认卡片缩略图放大查看
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // 2026/07:编辑 prompt 时 @ 参考图 —— mentionPickerFor 是当前展开选择条的卡片 msgId
  const [mentionPickerFor, setMentionPickerFor] = useState<string | null>(null);
  // contentEditable div 的 ref(每条卡片一个),用于 @ 参考图插入光标管理
  const promptDivRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" });
  }, [messages]);

  // 把 messages 落盘到 localStorage。每次 messages 变化(用户发送、AI
  // 推进步骤、点 CTA)都同步一次,关闭浏览器再打开还在。
  // workspaceId 进 key,这样切换工作空间不会读到上一个的记录。
  useEffect(() => {
    saveStoredMessages(workspaceId, messages);
  }, [messages, workspaceId]);

  useEffect(() => {
    setSkipCreditConfirmation(
      window.localStorage.getItem(`doopoo:agent-skip-credit-confirm:${workspaceId}`) === "true",
    );
  }, [workspaceId]);

  // 从首页带入的预填文本：仅在首次有值时填入输入框
  useEffect(() => {
    if (initialInput && initialInput.trim()) {
      setInput(initialInput);
    }
  }, [initialInput]);

  // 切换流程(stage)或选择不同集数时,重置临时 UI 状态(参数面板 /
  // 修改模式 / CTA 折叠),让目标流程的引导 CTA 重新出现。
  // 注意:历史消息(messages)不再清空 —— 用户期望切 tab 也能看到
  // 之前的对话,持久化由上面的 effect 负责。
  // 流式生成中跳过,避免打断用户输入与进度展示。
  useEffect(() => {
    if (streaming) return;
    setPendingCta(null);
    setSynopsisEditMode(false);
    setEpisodeEditMode(null);
    setCtasCollapsed(false);
  }, [stage, selectedEpisodeIndex, streaming]);

  const intro: Record<WorkspaceTab, string> = {
    canvas: t.zp_intro_canvas,
    script: t.zp_intro_script,
    episodes: t.zp_intro_episodes,
    character: t.zp_intro_character,
    storyboard: t.zp_intro_storyboard,
    timeline: t.zp_intro_timeline,
  };

  const presets: Record<WorkspaceTab, string[]> = {
    canvas: [t.zp_preset_idea, t.zp_preset_design],
    script: [t.zp_preset_suspense, t.zp_preset_campus, t.zp_preset_idea, t.zp_preset_design],
    episodes: [t.zp_preset_episodes_refine, t.zp_preset_episodes_extract],
    character: [t.zp_preset_lead, t.zp_preset_villain, t.zp_preset_supporting],
    storyboard: [t.zp_preset_board, t.zp_preset_expand],
    timeline: [t.zp_preset_arrange, t.zp_preset_transition],
  };

  // 某些阶段的"无消息"空状态应该直接展示功能性 CTA 按钮(走 handleCta),
  // 而不是文本预设(只是 send(p) 的占位文案)。典型场景:导入剧本后或
  // AI 生成完一集后,回到 episodes 标签,应该看到和 AI 工作流收尾时
  // 完全一样的"AI 修改本集" / "提取本集角色和场景"按钮,而不是无关的
  // 文本提示。character / storyboard 阶段也用 CTA,把"进入分镜(AI 切分多组)"
  // 放最前,方便用户点一下就走完整剧情→分镜组流程,不需要发消息。
  const presetCtas: Record<
    WorkspaceTab,
    { key: CtaKey; label: string; target: WorkspaceTab }[] | null
  > = {
    canvas: null,
    // 2026/06 改:script 阶段之前为 null,只显示 4 个文本预设(占位文案),
    // 用户生成完故事梗概后看不到任何功能性按钮。现在跟 character / storyboard
    // 对齐,直接展示 3 个 CTA:生成下一集 / 连续生成多集 / AI 修改故事梗概。
    //   - script_next     → handleCta 调 send() 走 runScriptEpisode 流式生成
    //   - script_continue → 走连续多集参数化提示(用户选 target + sceneCount)
    //   - script_episode  → 打开"修改剧本梗概"输入框(见 handleCta line 713)
    // i18n + handleCta 分支都已经存在,只是之前没接进 UI。
    script: [
      { key: "script_next", label: t.zp_cta_script_next, target: "script" },
      { key: "script_continue", label: t.zp_cta_script_continue, target: "script" },
      { key: "script_episode", label: t.zp_cta_script_episode, target: "script" },
      { key: "extract", label: t.zp_cta_extract, target: "character" },
    ],
    episodes: buildWorkflow("episodes", t).ctas,
    character: [
      { key: "extract", label: t.zp_cta_extract, target: "character" },
      { key: "select_episodes", label: t.zp_cta_select_episodes, target: "episodes" },
      { key: "enter_storyboard", label: t.zp_cta_enter_storyboard, target: "storyboard" },
    ],
    // storyboard 之前是 null(只显示文本预设),导致点击分镜流程时对话框
    // 没有"对话按钮"。改为 CTA 列表,与 episodes / character 行为一致:
    // 用户切到分镜流程时,直接看到"进入时间轴阶段 / 继续精修"等按钮。
    storyboard: buildWorkflow("storyboard", t).ctas,
    timeline: null,
  };

  function newChat() {
    setMessages([]);
    setInput("");
    attachments.forEach((a) => a.url && URL.revokeObjectURL(a.url));
    setAttachments([]);
    // 同步清掉 localStorage,不然刷新页面又会把旧历史读回来。
    clearStoredMessages(workspaceId);
  }

  function onFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next: Attachment[] = [];
    Array.from(files).forEach((f) => {
      next.push({
        id: `${Date.now()}-${f.name}-${Math.random().toString(36).slice(2, 7)}`,
        name: f.name,
        size: f.size,
        type: f.type,
        url: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
      });
    });
    setAttachments((prev) => [...prev, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target?.url) URL.revokeObjectURL(target.url);
      return prev.filter((a) => a.id !== id);
    });
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function setProjectCreditConfirmationPreference(skip: boolean) {
    setSkipCreditConfirmation(skip);
    try {
      window.localStorage.setItem(`doopoo:agent-skip-credit-confirm:${workspaceId}`, String(skip));
    } catch {
      // localStorage 不可用时仅保留当前会话偏好。
    }
  }

  function executeReferenceModification(
    refInfo: NonNullable<typeof pendingRef>,
    instruction: string,
  ) {
    onModifyReference?.(
      refInfo.refType,
      refInfo.refId,
      instruction,
      refInfo.lookId,
      refInfo.imageUrl,
    );
    setPendingReferenceCost(null);
  }

  async function executeAgentPlan(messageId: string, plan: WorkspaceAgentPlan) {
    if (plan.action === "clarify" || plan.action === "explain_capabilities") return;
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId && message.kind === "agent_plan"
          ? { ...message, status: "executing" }
          : message,
      ),
    );
    try {
      const result = await onExecuteAgentAction?.(plan);
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId && message.kind === "agent_plan"
            ? { ...message, status: "done", result: result?.summary ?? "已完成。" }
            : message,
        ),
      );
    } catch (error) {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId && message.kind === "agent_plan"
            ? {
                ...message,
                status: "pending",
                result: error instanceof Error ? error.message : "执行失败，请调整后重试。",
              }
            : message,
        ),
      );
    }
  }

  function queueAgentPlan(plan: WorkspaceAgentPlan) {
    const planId = `plan-${Date.now()}`;
    setMessages((prev) => [...prev, { id: planId, kind: "agent_plan", plan, status: "pending" }]);
    if (
      plan.action !== "clarify" &&
      plan.action !== "explain_capabilities" &&
      (!plan.requiresCredit || skipCreditConfirmation)
    ) {
      void executeAgentPlan(planId, plan);
    }
  }

  type AvailablePageAction = {
    id: string;
    label: string;
    hint?: string;
    requiresCredit: boolean;
  };

  function collectAvailablePageActions(): AvailablePageAction[] {
    if (typeof document === "undefined") return [];
    const root = document.querySelector("main");
    if (!root) return [];
    const costPattern = /生成|重生|提取|融合|连跑|切分|渲染|写剧本|开始创作/;
    return Array.from(root.querySelectorAll<HTMLElement>("button, a[href], label[for], [role=button]"))
      .filter((element) => {
        const disabled = element instanceof HTMLButtonElement && element.disabled;
        const hidden = element.getClientRects().length === 0;
        return !disabled && !hidden;
      })
      .slice(0, 160)
      .map((element, index) => {
        const label = (element.innerText || element.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
        const id = `ui-${index}`;
        element.dataset.doopooAgentAction = id;
        return {
          id,
          label: label.slice(0, 120) || "未命名操作",
          hint: element.getAttribute("title")?.slice(0, 160) || undefined,
          requiresCredit: costPattern.test(label),
        };
      })
      .filter((action) => action.label !== "未命名操作");
  }

  async function planAgentCommand(userMsg: Message & { kind: "user" }) {
    const thoughtId = `agent-thought-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: thoughtId, kind: "agent_thought", text: "正在理解目标、确认所需页面和执行顺序…", pending: true },
    ]);
    try {
      const availableActions = collectAvailablePageActions();
      const responsePlan = await callPlanAgentAction({
        data: {
          instruction: userMsg.text,
          stage,
          selectedEpisodeIndex,
          context: {
            episodeCount: episodeCount ?? 0,
            characterCount: agentContext?.characterCount ?? 0,
            storyboardGroupCount: agentContext?.storyboardGroupCount ?? 0,
            hasSynopsis: agentContext?.hasSynopsis ?? false,
          },
          availableActions,
        },
      });
      const selectedButton = availableActions.find((action) => action.id === responsePlan.uiActionId);
      const plan: WorkspaceAgentPlan =
        responsePlan.action === "click_ui" &&
        !selectedButton &&
        !responsePlan.uiActionLabel &&
        !responsePlan.uiSteps?.some((step) => step.uiActionId || step.uiActionLabel)
          ? {
              action: "clarify",
              targetStage: stage,
              title: "找不到要操作的按钮",
              summary: "页面状态已变化，无法安全地执行该操作。",
              executionPrompt: "",
              requiresCredit: false,
              clarification: "请确认左侧页面已打开目标内容后，再告诉我要点击的按钮名称。",
            }
          : {
              ...responsePlan,
              requiresCredit:
                responsePlan.action === "click_ui"
                  ? (selectedButton?.requiresCredit ?? responsePlan.requiresCredit)
                  : responsePlan.requiresCredit,
              uiActionLabel: selectedButton?.label ?? responsePlan.uiActionLabel,
            };
      setMessages((prev) =>
        prev.map((message) =>
          message.id === thoughtId && message.kind === "agent_thought"
            ? {
                ...message,
                pending: false,
                text:
                  plan.action === "clarify"
                    ? `我需要补充一点信息：${plan.summary}`
                    : `我理解为：${plan.summary}${plan.requiresCredit ? " 接下来会先向你确认积分消耗。" : " 正在按这个顺序执行。"}`,
              }
            : message,
        ),
      );
      queueAgentPlan(plan);
    } catch {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === thoughtId && message.kind === "agent_thought"
            ? { ...message, pending: false, text: "暂时无法完成规划，我会给出可继续执行的下一步。" }
            : message,
        ),
      );
      queueAgentPlan({
        action: "clarify",
        targetStage: stage,
        title: "暂时无法规划此操作",
        summary: "请补充要操作的阶段或具体对象后重试。",
        executionPrompt: "",
        requiresCredit: false,
        clarification: "例如：提取第 2 集角色场景，或切分当前集分镜。",
      });
    }
  }

  // ============= Import script flow =============
  // Read a File into plain text. .txt uses FileReader, .docx is parsed via mammoth
  // (lazy-loaded to keep the .docx dependency out of the initial bundle).
  async function readFileToText(file: File): Promise<string> {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".txt")) return await file.text();
    if (lower.endsWith(".docx")) {
      const mod: any = await import("mammoth");
      const mammoth = mod.default ?? mod;
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      if (!result?.value || !result.value.trim()) throw new Error(t.zp_import_error_corrupt);
      return result.value;
    }
    throw new Error(t.zp_import_error_format);
  }

  function openImportModal() {
    // Close any other modal to avoid z-50 stacking
    setPendingCta(null);
    setImportModal({ stage: "paste", text: "", fileName: null });
  }

  function closeImportModal() {
    if (importModal?.stage === "parsing") return; // ignore close while in-flight
    setImportModal(null);
    setImportDragging(false);
  }

  async function handleImportFilePicked(file: File | null | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setImportModal({ stage: "error", message: t.zp_import_error_too_big });
      return;
    }
    if (!/\.(docx|txt)$/i.test(file.name)) {
      setImportModal({ stage: "error", message: t.zp_import_error_format });
      return;
    }
    try {
      const text = await readFileToText(file);
      setImportModal({ stage: "paste", text, fileName: file.name });
    } catch (e) {
      setImportModal({
        stage: "error",
        message: e instanceof Error && e.message ? e.message : t.zp_import_error_read,
      });
    }
    if (importFileInputRef.current) importFileInputRef.current.value = "";
  }

  function onImportFilePickedEvent(e: React.ChangeEvent<HTMLInputElement>) {
    void handleImportFilePicked(e.target.files?.[0]);
  }

  function onImportFileDropped(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setImportDragging(false);
    const file = e.dataTransfer.files?.[0];
    void handleImportFilePicked(file);
  }

  async function onImportSubmit() {
    if (!importModal || importModal.stage !== "paste") return;
    const text = importModal.text.trim();
    if (text.length < 20) {
      setImportModal({ stage: "error", message: t.zp_import_error_short });
      return;
    }
    setImportModal({ stage: "parsing", progress: t.zp_import_parsing });
    try {
      // 消费流式 server fn：阶段 1 提交时即开始 yield，UI 实时刷新进度文案，
      // 避免长任务下"球状 spinner 静止 60s 再抛 AbortError"的死等感。
      const stream = (await callParseScript({
        data: { lang, rawText: text },
      })) as AsyncIterable<ParseStreamEvent>;
      for await (const ev of stream) {
        if (ev.kind === "progress") {
          setImportModal({ stage: "parsing", progress: ev.message });
        } else if (ev.kind === "error") {
          setImportModal({ stage: "error", message: ev.message });
          return;
        } else if (ev.kind === "done") {
          onImportScript?.(ev.result);
          setImportModal(null);
          setImportDragging(false);
          // toast handled by parent (workspace) so the count can be shown
          return;
        }
      }
    } catch (e) {
      // for-await 外的网络/解包错误（如 server fn 自身抛 AbortError）
      const err = e as { name?: string; message?: string };
      const msg =
        err?.name === "AbortError"
          ? t.zp_import_error_timeout
          : err?.message || t.zp_import_error_unknown;
      setImportModal({ stage: "error", message: msg });
    }
  }

  function send(
    text: string,
    opts?: { targetStage?: WorkspaceTab; jumpAfter?: boolean; simple?: boolean },
  ) {
    let trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;

    // If in synopsis edit mode, prepend the instruction prefix
    // and use simple mode (streaming shows in main area)
    let isSynopsisModify = false;
    if (synopsisEditMode && trimmed) {
      trimmed = `修改剧本梗概\n${trimmed}`;
      setSynopsisEditMode(false);
      isSynopsisModify = true;
    }

    // If in episode edit mode, prepend "修改第 X 集剧本\n" prefix
    // and use simple mode (no workflow animation, streaming shows in main area)
    let isEpisodeModify = false;
    if (episodeEditMode != null && trimmed) {
      trimmed = `修改第 ${episodeEditMode} 集剧本\n${trimmed}`;
      setEpisodeEditMode(null);
      isEpisodeModify = true;
    }

    const inferredJump = opts?.jumpAfter ?? false;
    const targetStage = opts?.targetStage ?? stage;
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      kind: "user",
      text: trimmed,
      attachments: attachments.length ? attachments : undefined,
    };

    // Simple mode: only add user message, no workflow animation or summary
    // Used for episode/synopsis modifications where streaming content appears in the main area
    if (opts?.simple || isEpisodeModify || isSynopsisModify) {
      // Show a "modifying" status message in chat
      const statusId = `s-${Date.now()}`;
      const statusLabel = isEpisodeModify ? "正在修改剧本…" : "正在修改故事梗概…";
      setMessages((m) => [
        ...m,
        userMsg,
        { id: statusId, kind: "workflow", steps: [statusLabel], doneCount: 0 },
      ]);
      setInput("");
      setAttachments([]);
      // Wait for produce to complete, then update status with CTAs
      const produceResult = onProduce?.(targetStage, trimmed);
      Promise.resolve(produceResult).then(() => {
        const ctas: { key: CtaKey; label: string; target: WorkspaceTab }[] = isEpisodeModify
          ? [
              { key: "episode_modify", label: "AI修改本集剧本", target: "episodes" },
              { key: "extract", label: "提取本集角色和场景", target: "character" },
            ]
          : [];
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === statusId && msg.kind === "workflow"
              ? {
                  ...msg,
                  doneCount: 1,
                  summary: {
                    title: "修改完成",
                    detail: isEpisodeModify
                      ? "剧本已更新，可在上方查看修改后的内容。"
                      : "故事梗概已更新。",
                    next: isEpisodeModify
                      ? "可以继续修改或提取角色和场景。"
                      : "如需继续调整，请直接输入修改意见。",
                  },
                  ctas,
                }
              : msg,
          ),
        );
      });
      return;
    }

    // 2026/06:如果有待发送的引用修改(pendingRef),走 onModifyReference 回调
    if (pendingRef) {
      const refText = `修改${pendingRef.refType === "character" ? "角色" : pendingRef.refType === "scene" ? "场景" : "道具"}「${pendingRef.label}」: ${trimmed}`;
      const userMsg: Message = { id: `u-${Date.now()}`, kind: "user", text: refText };
      setMessages((m) => [...m, userMsg]);
      setInput("");
      setAttachments([]);
      const pr = pendingRef;
      setPendingRef(null);
      if (skipCreditConfirmation) {
        executeReferenceModification(pr, trimmed);
      } else {
        setPendingReferenceCost({ ref: pr, instruction: trimmed });
      }
      return;
    }

    // 自由输入走真正的 Agent 规划器：先理解意图，再决定是否需要积分确认。
    // 有 targetStage 的 CTA 保持既有参数化工作流，避免改变已验证的按钮行为。
    if (!opts) {
      setInput("");
      setAttachments([]);
      void planAgentCommand(userMsg);
      return;
    }

    // Normal mode:把"用户消息 + 工作流步骤动画 + 完成后展示 summary/CTA"
    // 这套逻辑交给 runWorkflowAnimation 统一处理(让"进入分镜阶段"这种
    // 走 onEnterStoryboard 的 CTA 也能复用同一套动画和收尾)。
    setInput("");
    setAttachments([]);
    runWorkflowAnimation(targetStage, () => onProduce?.(targetStage, trimmed), {
      jumpAfter: inferredJump,
      userMsg,
    });
  }

  /**
   * 跑"AI 工作流"动画:推一条 user 消息(可选)+ 一条 workflow 消息,
   * 逐步推进 doneCount;awaitable() resolve 后,把 workflow 标记完成并展
   * 示 summary + ctas,可选地跳转到目标 tab。
   *
   * 抽出来是为了让非 send() 入口(比如对话框的"进入分镜阶段" CTA,实
   * 际工作走 onEnterStoryboard 而不是 onProduce)也能共享同一种动画
   * 和收尾。
   */
  function runWorkflowAnimation(
    targetStage: WorkspaceTab,
    awaitable: () => unknown | Promise<unknown>,
    opts?: { jumpAfter?: boolean; userMsg?: Message },
  ) {
    const wf = buildWorkflow(targetStage, t);
    const wfId = `w-${Date.now()}`;
    setMessages((m) => [
      ...m,
      ...(opts?.userMsg ? [opts.userMsg] : []),
      { id: wfId, kind: "workflow", steps: wf.steps, doneCount: 0, stage: targetStage },
    ]);
    // 2026/06:分镜流进入 + 缩略图渲染 步骤要看得清,stepDelay 700 → 1800ms
    const stepDelay = 1800;
    const lastStepIndex = wf.steps.length - 1;
    wf.steps.forEach((_, i) => {
      if (i === lastStepIndex) return;
      setTimeout(
        () => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === wfId && msg.kind === "workflow" ? { ...msg, doneCount: i + 1 } : msg,
            ),
          );
        },
        (i + 1) * stepDelay,
      );
    });

    const minDuration = wf.steps.length * stepDelay;
    const startedAt = Date.now();
    Promise.resolve(awaitable()).then(() => {
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, minDuration - elapsed);
      setTimeout(() => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === wfId && msg.kind === "workflow"
              ? { ...msg, doneCount: wf.steps.length, summary: wf.summary, ctas: wf.ctas }
              : msg,
          ),
        );
        if (opts?.jumpAfter) {
          // 历史消息由 localStorage 持久化,这里切 tab 不会再被擦掉。
          onJumpStage(targetStage);
        }
      }, wait);
    });
  }

  // 2026/06:外部 signal 触发"进入时间轴流程"动画。
  // 当父组件把 enterTimelineSignal 数字 +1 时,这里跑一遍 tl_load/tl_align/...
  // 5 步工作流,然后 jumpAfter=true 自动切到 timeline tab。
  useEffect(() => {
    if (!enterTimelineSignal) return;
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      kind: "user",
      text: t.zp_user_quick_timeline,
    };
    runWorkflowAnimation(
      "timeline",
      () => {
        void onEnterTimeline?.();
      },
      {
        jumpAfter: true,
        userMsg,
      },
    );
    // 只在外部 signal 变化时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enterTimelineSignal]);

  // 2026/06:暴露给父组件的 triggerWorkflow 实现。
  // 当内容区域按钮(如"提取第 X 集角色")想要触发工作流动画时,
  // 父组件通过 ref 调用此方法,内部走 runWorkflowAnimation 在左侧对话框显示动画。
  useImperativeHandle(
    ref,
    () => ({
      triggerWorkflow: (
        targetStage: WorkspaceTab,
        awaitable: () => unknown | Promise<unknown>,
        opts?: { jumpAfter?: boolean; userMsg?: string },
      ) => {
        const userMsg: Message | undefined = opts?.userMsg
          ? { id: `u-${Date.now()}`, kind: "user", text: opts.userMsg }
          : undefined;
        runWorkflowAnimation(targetStage, awaitable, { jumpAfter: opts?.jumpAfter, userMsg });
      },
      setPendingRef: (
        refType: "character" | "scene" | "prop",
        refId: string,
        label: string,
        imageUrl: string,
        lookId?: string | null,
      ) => {
        setPendingRef({ refType, refId, label, imageUrl, lookId });
        setInput(
          `修改${refType === "character" ? "角色" : refType === "scene" ? "场景" : "道具"}「${label}」: `,
        );
        setTimeout(() => textareaRef.current?.focus(), 50);
        setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" }), 50);
      },
      pushVideoConfirmCard: (payload) => {
        const msg: Message = {
          id: `vc-${Date.now()}`,
          kind: "video_confirm",
          groupId: payload.groupId,
          method: payload.method,
          title: payload.title,
          previewPrompt: payload.previewPrompt,
          images: payload.images,
          extra: payload.extra,
          audioCandidates: payload.audioCandidates,
          status: "pending",
        };
        setMessages((m) => [...m, msg]);
        setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" }), 50);
      },
    }),
    [runWorkflowAnimation],
  );

  // ParamField / ParamSpec 已在 useState 之前定义(见上面),
  // 这里不再重复声明,直接用。
  function getParamSpec(c: { key: CtaKey; target: WorkspaceTab }): ParamSpec | null {
    switch (c.key) {
      case "extract":
        return {
          baseText: t.zp_user_cta_extract,
          targetStage: "character",
          jumpAfter: true,
          fields: [
            {
              key: "episode",
              label: "选择集数",
              default: String(selectedEpisodeIndex ?? 1),
              options: [], // 空数组 = 让用户自行输入集数
              custom: true,
            },
            {
              key: "scope",
              label: t.zp_param_f_scope,
              default: "supp",
              options: [
                { value: "main", label: t.zp_opt_scope_main },
                { value: "supp", label: t.zp_opt_scope_supp },
                { value: "all", label: t.zp_opt_scope_all },
              ],
            },
            {
              key: "scenes",
              label: t.zp_param_f_include_scenes,
              default: "yes",
              options: [
                { value: "yes", label: t.zp_opt_yes },
                { value: "no", label: t.zp_opt_no },
              ],
            },
          ],
        };
      case "design":
      case "to_character":
        return {
          baseText: c.key === "design" ? t.zp_user_cta_design : t.zp_user_cta_to_character,
          targetStage: "character",
          jumpAfter: true,
          fields: [
            {
              key: "style",
              label: t.zp_param_f_style,
              default: "real",
              options: [
                { value: "real", label: t.zp_opt_style_real },
                { value: "anime", label: t.zp_opt_style_anime },
                { value: "illust", label: t.zp_opt_style_illust },
                { value: "ink", label: t.zp_opt_style_ink },
              ],
            },
            {
              key: "views",
              label: t.zp_param_f_views,
              default: "3",
              options: [
                { value: "3", label: t.zp_opt_views_3 },
                { value: "5", label: t.zp_opt_views_5 },
                { value: "full", label: t.zp_opt_views_full },
              ],
            },
            {
              key: "count",
              label: t.zp_param_f_count,
              default: "5",
              options: [
                { value: "3", label: t.zp_opt_count_3 },
                { value: "5", label: t.zp_opt_count_5 },
                { value: "8", label: t.zp_opt_count_8 },
              ],
            },
            {
              key: "depth",
              label: t.zp_param_f_depth,
              default: "basic",
              options: [
                { value: "basic", label: t.zp_opt_depth_basic },
                { value: "deep", label: t.zp_opt_depth_deep },
              ],
            },
          ],
        };
      case "storyboard":
        return {
          baseText: t.zp_user_cta_storyboard,
          targetStage: "storyboard",
          jumpAfter: true,
          fields: [
            {
              key: "shots",
              label: t.zp_param_f_shots,
              default: "12",
              options: [
                { value: "8", label: t.zp_opt_shots_8 },
                { value: "12", label: t.zp_opt_shots_12 },
                { value: "24", label: t.zp_opt_shots_24 },
              ],
            },
            {
              key: "aspect",
              label: t.zp_param_f_aspect,
              default: "9_16",
              options: [
                { value: "16_9", label: t.zp_opt_aspect_16_9 },
                { value: "9_16", label: t.zp_opt_aspect_9_16 },
                { value: "4_3", label: t.zp_opt_aspect_4_3 },
              ],
            },
            {
              key: "lock",
              label: t.zp_param_f_lock,
              default: "strict",
              options: [
                { value: "strict", label: t.zp_opt_lock_strict },
                { value: "loose", label: t.zp_opt_lock_loose },
              ],
            },
          ],
        };
      case "to_script":
        return {
          baseText: t.zp_user_cta_to_script,
          targetStage: "script",
          jumpAfter: true,
          fields: [
            {
              key: "tone",
              label: t.zp_param_f_tone,
              default: "suspense",
              options: [
                { value: "suspense", label: t.zp_opt_tone_suspense },
                { value: "heal", label: t.zp_opt_tone_heal },
                { value: "comedy", label: t.zp_opt_tone_comedy },
                { value: "campus", label: t.zp_opt_tone_campus },
              ],
            },
            {
              key: "len",
              label: t.zp_param_f_length,
              default: "m",
              options: [
                { value: "s", label: t.zp_opt_len_s },
                { value: "m", label: t.zp_opt_len_m },
                { value: "l", label: t.zp_opt_len_l },
              ],
            },
          ],
        };
      case "generate_script":
        return {
          baseText: t.zp_user_cta_generate_script,
          targetStage: "script",
          jumpAfter: false,
          fields: [
            {
              key: "type",
              label: t.script_type,
              default: "Short",
              options: [
                { value: "Micro", label: t.script_type_micro },
                { value: "Short", label: t.script_type_short },
                { value: "Feature", label: t.script_type_feature },
                { value: "Ad", label: t.script_type_ad },
              ],
            },
            {
              key: "genre",
              label: t.script_genre,
              default: "Drama",
              multiSelect: true,
              options: [
                { value: "Sci-Fi", label: t.script_genre_scifi },
                { value: "Romance", label: t.script_genre_romance },
                { value: "Thriller", label: t.script_genre_thriller },
                { value: "Comedy", label: t.script_genre_comedy },
                { value: "Drama", label: t.script_genre_drama },
                { value: "Horror", label: t.script_genre_horror },
                { value: "Fantasy", label: t.script_genre_fantasy },
                { value: "Historical", label: t.script_genre_historical },
              ],
            },
            {
              key: "tone",
              label: t.script_tone,
              default: "Serious",
              multiSelect: true,
              options: [
                { value: "Serious", label: t.script_tone_serious },
                { value: "Comedy", label: t.script_tone_comedy },
                { value: "Suspense", label: t.script_tone_suspense },
                { value: "Romance", label: t.script_tone_romance },
                { value: "Horror", label: t.script_tone_horror },
              ],
            },
            {
              key: "expectedEpisodes",
              label: "预计集数",
              default: "30",
              custom: true,
              options: [
                { value: "30", label: "30 集" },
                { value: "60", label: "60 集" },
                { value: "100", label: "100 集" },
                { value: "150", label: "150 集" },
              ],
            },
            {
              key: "totalMinutes",
              label: "总时长（分钟）",
              default: "90",
              custom: true,
              options: [
                { value: "30", label: "30 分钟" },
                { value: "60", label: "60 分钟" },
                { value: "90", label: "90 分钟" },
                { value: "180", label: "180 分钟" },
              ],
            },
          ],
        };
      case "script_continue":
        return {
          baseText: t.zp_user_cta_script_continue,
          targetStage: "script",
          jumpAfter: false,
          fields: [
            {
              key: "targetEp",
              label: "连跑至第",
              default: "10",
              custom: true,
              options: [
                { value: "5", label: "第 5 集" },
                { value: "10", label: "第 10 集" },
                { value: "20", label: "第 20 集" },
                { value: "30", label: "第 30 集" },
              ],
            },
            {
              key: "sceneCount",
              label: "每集分镜数",
              default: "5",
              custom: true,
              options: [
                { value: "3", label: "3 个" },
                { value: "5", label: "5 个" },
                { value: "7", label: "7 个" },
                { value: "9", label: "9 个" },
              ],
            },
          ],
        };
      case "script_next":
        return {
          baseText: t.zp_user_cta_script_next,
          targetStage: "script",
          jumpAfter: false,
          fields: [
            {
              key: "sceneCount",
              label: "每集分镜数",
              default: "5",
              custom: true,
              options: [
                { value: "3", label: "3 个" },
                { value: "5", label: "5 个" },
                { value: "7", label: "7 个" },
                { value: "9", label: "9 个" },
              ],
            },
          ],
        };
      case "script_episode":
        return {
          baseText: t.zp_user_cta_script_episode,
          targetStage: "script",
          jumpAfter: false,
          fields: [],
        };
      case "to_timeline":
        return {
          baseText: t.zp_user_cta_to_timeline,
          targetStage: "timeline",
          jumpAfter: true,
          fields: [
            {
              key: "density",
              label: t.zp_param_f_density,
              default: "std",
              options: [
                { value: "tight", label: t.zp_opt_density_tight },
                { value: "std", label: t.zp_opt_density_std },
                { value: "loose", label: t.zp_opt_density_loose },
              ],
            },
            {
              key: "audio",
              label: t.zp_param_f_audio,
              default: "full",
              options: [
                { value: "full", label: t.zp_opt_audio_full },
                { value: "mute", label: t.zp_opt_audio_mute },
              ],
            },
          ],
        };
      case "refine":
        return {
          baseText: t.zp_user_cta_refine,
          targetStage: c.target,
          jumpAfter: false,
          fields: [
            {
              key: "focus",
              label: t.zp_param_f_focus,
              default: "visual",
              options: [
                { value: "pace", label: t.zp_opt_focus_pace },
                { value: "dialog", label: t.zp_opt_focus_dialog },
                { value: "visual", label: t.zp_opt_focus_visual },
                { value: "emotion", label: t.zp_opt_focus_emotion },
              ],
            },
            {
              key: "strength",
              label: t.zp_param_f_strength,
              default: "mid",
              options: [
                { value: "light", label: t.zp_opt_strength_light },
                { value: "mid", label: t.zp_opt_strength_mid },
                { value: "strong", label: t.zp_opt_strength_strong },
              ],
            },
          ],
        };
      default:
        return null;
    }
  }

  /**
   * 2026/07:在 contentEditable div 当前光标位置插入高亮 @ 参考图标签(如 @首帧),
   * 标签是 contentEditable=false 的 span(不可编辑,整体)。插入后光标移到标签后。
   * previewPrompt 同步为 div.innerText(纯文本,含 @label),发给 AI 用。
   */
  function insertRefAtCursor(msgId: string, label: string) {
    const div = promptDivRefs.current.get(msgId);
    if (!div) return;
    div.focus();
    const sel = window.getSelection();
    let range: Range;
    if (sel && sel.rangeCount > 0 && div.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0);
    } else {
      // 光标不在 div 内 → 移到末尾
      range = document.createRange();
      range.selectNodeContents(div);
      range.collapse(false);
    }
    range.deleteContents();
    // 高亮 @标签 span(不可编辑,整体)
    const tag = document.createElement("span");
    tag.contentEditable = "false";
    tag.className =
      "bg-accent-dim/70 text-accent rounded px-1 py-0.5 text-[11px] font-semibold mx-0.5 align-middle";
    tag.textContent = `@${label}`;
    // 后接空格,方便光标移到标签后继续输入
    const space = document.createTextNode(" ");
    range.insertNode(space);
    range.insertNode(tag);
    range.setStartAfter(space);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    // 同步纯文本到 state(发给 AI 用)
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.kind === "video_confirm" ? { ...m, previewPrompt: div.innerText } : m,
      ),
    );
    setMentionPickerFor(null);
  }

  /**
   * 2026/07:视频确认卡片点"确认生成"的处理。
   * 先把卡片状态置 generating,await onConfirmVideoGen(父组件真正生成),
   * 成功→done,失败/异常→failed(可重试)。状态全部写回 messages。
   */
  async function handleConfirmVideo(
    msgId: string,
    groupId: string,
    method: "shots" | "storyboard",
    previewPrompt: string,
    selectedAudioUrl?: string,
  ) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId && m.kind === "video_confirm" ? { ...m, status: "generating" } : m,
      ),
    );
    try {
      const ok =
        (await onConfirmVideoGen?.(groupId, method, previewPrompt, selectedAudioUrl)) ?? false;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.kind === "video_confirm"
            ? { ...m, status: ok ? "done" : "failed" }
            : m,
        ),
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.kind === "video_confirm" ? { ...m, status: "failed" } : m,
        ),
      );
    }
  }

  function handleCta(c: { key: CtaKey; label: string; target: WorkspaceTab }) {
    if (c.key === "preview") {
      onJumpStage(c.target);
      return;
    }
    // enter_storyboard:在对话框点"进入分镜",走专门的剧情→分镜组流程。
    // 用 runWorkflowAnimation 共享同一种 AI 工作流动画:对话框里逐步
    // 推进 [加载工作流 / 解析剧本 / 规划镜头 / 草拟构图 / 渲染] 五步,
    // await onEnterStoryboard() 完成,展示 summary + "进入时间轴阶段 /
    // 继续精修" CTAs,再自动切到分镜 tab。
    if (c.key === "enter_storyboard") {
      queueAgentPlan({
        action: "create_storyboard_groups",
        targetStage: "storyboard",
        title: "切分当前集分镜",
        summary: "根据当前剧本、角色和场景生成分镜组。",
        executionPrompt: "",
        requiresCredit: true,
      });
      return;
    }
    if (c.key === "select_episodes") {
      send(t.zp_user_cta_select_episodes, { targetStage: "episodes", jumpAfter: true });
      return;
    }
    if (c.key === "script_episode") {
      setSynopsisEditMode(true);
      setInput("");
      setTimeout(() => textareaRef.current?.focus(), 50);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" }), 50);
      return;
    }
    if (c.key === "episode_modify") {
      const epIdx = selectedEpisodeIndex ?? 1;
      setEpisodeEditMode(epIdx);
      setInput("");
      setTimeout(() => textareaRef.current?.focus(), 50);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" }), 50);
      return;
    }
    // extract: from episodes/script tab → directly send (skip param panel), extract characters + scenes from current episode
    if (c.key === "extract") {
      if (stage === "episodes" || stage === "script") {
        const epIdx = selectedEpisodeIndex ?? 1;
        send(`从第 ${epIdx} 集提取角色和场景`, { targetStage: "character", jumpAfter: true });
      } else {
        // 从 character/storyboard 等 tab → 先弹出集数选择参数面板
        const spec = getParamSpec(c);
        if (spec) {
          const defaults: Record<string, string | string[]> = {};
          spec.fields.forEach((f) => {
            defaults[f.key] = f.default;
          });
          setPendingCta({ cta: c, spec, values: defaults, previewing: false });
        }
      }
      return;
    }
    const spec = getParamSpec(c);
    if (!spec) return;
    const defaults: Record<string, string | string[]> = {};
    spec.fields.forEach((f) => {
      defaults[f.key] = f.default;
    });
    setPendingCta({ cta: c, spec, values: defaults, previewing: false });
  }

  function stageTag(c: { key: CtaKey; target: WorkspaceTab }, targetStage: WorkspaceTab): string {
    if (c.key === "refine") return t.zp_tag_refine;
    const map: Record<WorkspaceTab, string> = {
      canvas: t.zp_tag_canvas,
      script: t.zp_tag_script,
      episodes: t.zp_tag_episodes,
      character: t.zp_tag_character,
      storyboard: t.zp_tag_storyboard,
      timeline: t.zp_tag_timeline,
    };
    return map[targetStage];
  }

  function buildPrompt(
    spec: ParamSpec,
    values: Record<string, string | string[]>,
    tag: string,
  ): string {
    // For streaming script CTAs, build the full prompt with all parameters inline
    if (spec.fields[0]?.key === "type") {
      const lines = spec.fields.map((f) => {
        const v = values[f.key];
        let display: string;
        if (f.multiSelect && Array.isArray(v)) {
          display = v.map((val) => f.options.find((o) => o.value === val)?.label ?? val).join("、");
        } else {
          const sv = typeof v === "string" ? v : "";
          display = f.options.find((o) => o.value === sv)?.label ?? sv;
        }
        return `- ${f.label}: ${display}`;
      });
      return `【${tag}】${spec.baseText}\n${lines.join("\n")}`;
    }
    // Order is fixed by spec.fields declaration order — canonical per stage.
    const lines = spec.fields.map((f) => {
      const opt = f.options.find((o) => o.value === values[f.key]);
      return `- ${f.label}: ${opt?.label ?? values[f.key] ?? ""}`;
    });
    return `【${tag}】${spec.baseText}\n${t.zp_prompt_params_header}\n${lines.join("\n")}`;
  }

  function confirmPendingCta() {
    if (!pendingCta) return;
    const { spec, values, cta } = pendingCta;
    const tag = stageTag(cta, spec.targetStage);

    // For generate_script, use send() workflow to show loading animation, jump after completion
    if (cta.key === "generate_script") {
      setPendingCta(null);
      const text = buildPrompt(spec, values, tag);
      queueAgentPlan({
        action: "produce_script", targetStage: "canvas", title: "生成故事梗概", summary: "根据已选参数生成剧本梗概。",
        executionPrompt: text, requiresCredit: true,
      });
      return;
    }

    // For script_next (generate one episode), send with scene count
    if (cta.key === "script_next") {
      setPendingCta(null);
      const sceneCount = values.sceneCount ?? "5";
      const text = `生成本集分镜\n分镜数：${sceneCount}`;
      queueAgentPlan({
        action: "produce_episode", targetStage: "script", title: "生成下一集剧本", summary: `按 ${sceneCount} 个分镜生成下一集剧本。`,
        executionPrompt: text, requiresCredit: true,
      });
      return;
    }

    // For extract (when coming from non-episodes tab with episode selection)
    if (cta.key === "extract") {
      setPendingCta(null);
      const epIdx = (values.episode as string) ?? String(selectedEpisodeIndex ?? 1);
      queueAgentPlan({
        action: "extract_assets", targetStage: "character", title: `提取第 ${epIdx} 集素材`, summary: "提取角色、场景和道具。",
        executionPrompt: `从第 ${epIdx} 集提取角色、场景和道具`, requiresCredit: true,
      });
      return;
    }

    // For script_continue (auto-run episodes), send with target and scene count
    if (cta.key === "script_continue") {
      setPendingCta(null);
      const targetEp = values.targetEp ?? "10";
      const sceneCount = values.sceneCount ?? "5";
      const text = `自动连跑多集\n连跑至第 ${targetEp} 集\n分镜数：${sceneCount}`;
      queueAgentPlan({
        action: "produce_episode", targetStage: "script", title: `连续生成至第 ${targetEp} 集`, summary: `每集按 ${sceneCount} 个分镜生成。`,
        executionPrompt: text, requiresCredit: true,
      });
      return;
    }

    const text = buildPrompt(spec, values, tag);
    setPendingCta(null);
    queueAgentPlan({
      action: "produce_workspace_content",
      targetStage: spec.targetStage,
      title: cta.label,
      summary: "按已选参数生成工作区内容。",
      executionPrompt: text,
      requiresCredit: true,
    });
  }

  if (collapsed) {
    return (
      <div className="w-12 border-l border-border bg-bg-surface flex flex-col items-center py-3 shrink-0">
        <button
          onClick={onToggleCollapsed}
          className="p-2 rounded-md hover:bg-bg-elevated text-text-muted"
          title={t.zp_expand}
        >
          <PanelRightOpen size={18} />
        </button>
      </div>
    );
  }

  const hasMessages = messages.length > 0;

  return (
    <aside className="w-[384px] border-l border-border bg-bg-surface flex flex-col shrink-0 min-h-0">
      {/* Header */}
      <div className="h-12 border-b border-border flex items-center px-3 gap-2 shrink-0">
        <button
          onClick={onToggleCollapsed}
          className="p-1 rounded-md hover:bg-bg-elevated text-text-muted"
          title={t.zp_collapse}
        >
          <PanelRightClose size={16} />
        </button>
        <div className="flex-1 px-2 py-1 rounded-md bg-bg-elevated border border-border text-xs inline-flex items-center justify-between">
          <span>{t.zp_chat_dropdown}</span>
          <ChevronDown size={12} />
        </div>
        <button
          onClick={newChat}
          className="px-2 py-1 rounded-md bg-bg-elevated border border-border text-xs inline-flex items-center gap-1 hover:border-accent"
        >
          <Plus size={12} /> {t.zp_new_chat}
        </button>
      </div>

      {/* Body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {!hasMessages ? (
          <div className="space-y-3">
            <p className="text-text-secondary leading-relaxed">{intro[stage]}</p>
            {stage === "script" && (
              <p className="text-text-secondary text-sm">{t.zp_intro_script_hint}</p>
            )}
            {presetCtas[stage] ? (
              // 该阶段的空状态用工作流 CTA(导入剧本后或 AI 生成一集后回到此页)
              <div className="text-text-secondary text-sm space-y-1">
                {presetCtas[stage]!.map((c) => (
                  <div key={c.key} className="flex items-center gap-2">
                    <Sparkles size={12} className="text-accent shrink-0" />
                    <span>{c.label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <ul className="text-text-secondary text-sm list-disc list-inside space-y-1">
                {presets[stage].map((p) => (
                  <li key={p}>"{p}"</li>
                ))}
              </ul>
            )}

            {/* Import script CTA — primary action, available on every tab */}
            <button
              onClick={openImportModal}
              disabled={streaming}
              className="w-full px-4 py-3 rounded-lg border-2 border-accent bg-accent-dim/40 text-sm font-semibold text-text-primary inline-flex items-center gap-2 hover:bg-accent-dim/60 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <Upload size={16} className="text-accent shrink-0" />
              <span>{t.zp_cta_import_script}</span>
              <span className="ml-auto text-[11px] text-text-muted font-normal truncate">
                {t.zp_cta_import_script_hint}
              </span>
            </button>
            <h3 className="font-display text-2xl font-bold text-text-primary mt-6">
              {t.zp_today_help}
            </h3>
            {presetCtas[stage] ? (
              // CTA 按钮区:点击直接调 handleCta(走工作流完成后的逻辑),
              // 而非 send(p) 的占位文案。和 AI 生成一集后看到的 CTA 完全一致。
              <div className="space-y-2 pt-2">
                {presetCtas[stage]!.map((c, i) => (
                  <button
                    key={c.key}
                    onClick={() => handleCta(c)}
                    className={`w-full px-4 py-3 rounded-lg border text-sm font-semibold transition ${
                      i === 0
                        ? "bg-accent-dim/40 border-accent text-text-primary hover:bg-accent-dim/60"
                        : "bg-bg-elevated border-border hover:border-accent"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-2 pt-2">
                {presets[stage].map((p, i) => (
                  <button
                    key={p}
                    onClick={() => send(p)}
                    className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition ${
                      i === 0
                        ? "bg-accent-dim/40 border-accent text-text-primary hover:bg-accent-dim/60"
                        : "bg-bg-elevated border-border hover:border-accent"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}

            <p className="text-xs text-text-muted pt-3">{t.zp_unsatisfied}</p>
          </div>
        ) : (
          messages.map((m) => {
            if (m.kind === "user") {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] space-y-2">
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 justify-end">
                        {m.attachments.map((a) => (
                          <div
                            key={a.id}
                            className="rounded-lg overflow-hidden border border-border bg-bg-elevated text-xs flex items-center gap-2 max-w-[180px]"
                          >
                            {a.url ? (
                              <img src={a.url} alt={a.name} className="w-12 h-12 object-cover" />
                            ) : (
                              <div className="w-10 h-10 flex items-center justify-center text-text-muted shrink-0">
                                <FileIcon size={16} />
                              </div>
                            )}
                            <div className="pr-2 py-1 min-w-0">
                              <div className="truncate">{a.name}</div>
                              <div className="text-text-muted">{formatSize(a.size)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {m.text && (
                      <div className="px-3 py-2 rounded-2xl bg-bg-elevated text-sm whitespace-pre-wrap break-words">
                        {m.text}
                      </div>
                    )}
                  </div>
                </div>
              );
            }
            if (m.kind === "agent_thought") {
              return (
                <div key={m.id} className="flex items-start gap-2 px-1 text-xs text-text-secondary">
                  {m.pending ? <Loader2 size={13} className="mt-0.5 animate-spin text-accent shrink-0" /> : <Sparkles size={13} className="mt-0.5 text-accent shrink-0" />}
                  <p className="leading-relaxed">{m.text}</p>
                </div>
              );
            }
            if (m.kind === "agent_plan") {
              const needsConfirmation =
                m.plan.requiresCredit && !skipCreditConfirmation && m.status === "pending";
              return (
                <div key={m.id} className="rounded-xl border border-accent/30 bg-accent-dim/10 p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <Sparkles size={15} className="text-accent mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-text-primary">{m.plan.title}</div>
                      <p className="text-xs text-text-secondary leading-relaxed mt-1">{m.plan.summary}</p>
                    </div>
                  </div>
                  {m.plan.action === "clarify" || m.plan.action === "explain_capabilities" ? (
                    <p className="text-xs rounded-md border border-border bg-bg-surface p-2 text-text-secondary">
                      {m.plan.clarification}
                    </p>
                  ) : needsConfirmation ? (
                    <div className="rounded-md border border-amber-500/35 bg-amber-500/10 p-2 space-y-2">
                      <p className="text-xs text-amber-700 dark:text-amber-300 inline-flex gap-1 items-center">
                        <AlertTriangle size={13} /> 此操作会消耗积分，确认后执行。
                      </p>
                      <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                        <input
                          type="checkbox"
                          checked={skipCreditConfirmation}
                          onChange={(event) => setProjectCreditConfirmationPreference(event.target.checked)}
                          className="accent-accent"
                        />
                        本项目后续积分操作不再提醒
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void executeAgentPlan(m.id, m.plan)}
                          className="px-2.5 py-1 rounded bg-accent text-accent-foreground text-xs font-semibold hover:opacity-90"
                        >
                          确认执行
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setMessages((prev) =>
                              prev.map((message) =>
                                message.id === m.id && message.kind === "agent_plan"
                                  ? { ...message, status: "cancelled" }
                                  : message,
                              ),
                            )
                          }
                          className="px-2.5 py-1 rounded border border-border text-xs text-text-secondary hover:border-accent"
                        >
                          暂不执行
                        </button>
                      </div>
                    </div>
                  ) : m.status === "executing" ? (
                    <p className="text-xs text-accent inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> 正在执行计划…</p>
                  ) : m.status === "done" ? (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ {m.result ?? "已完成。"}</p>
                  ) : m.status === "cancelled" ? (
                    <p className="text-xs text-text-muted">已取消，未执行。</p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void executeAgentPlan(m.id, m.plan)}
                      className="px-2.5 py-1 rounded border border-accent text-accent text-xs hover:bg-accent-dim"
                    >
                      执行计划
                    </button>
                  )}
                  {m.result && m.status === "pending" && !needsConfirmation && (
                    <p className="text-xs text-rose-500">{m.result}</p>
                  )}
                </div>
              );
            }
            if (m.kind === "video_confirm") {
              return (
                <div key={m.id} className="space-y-2">
                  <div className="text-sm font-semibold text-text-primary inline-flex items-center gap-1">
                    <Video size={12} className="text-accent shrink-0" /> {m.title}
                  </div>
                  {m.extra && Object.entries(m.extra).length > 0 && (
                    <div className="text-xs space-y-0.5 bg-bg-elevated/50 rounded-md p-2 border border-border">
                      {Object.entries(m.extra).map(([k, v]) => (
                        <div key={k}>
                          <span className="text-text-muted">{k}: </span>
                          <span className="font-mono text-text-secondary">{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {m.images.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs text-text-secondary">
                        {t.zp_video_confirm_refs}（{m.images.length}）
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {m.images.map((img, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setLightboxUrl(img.url)}
                            className="relative w-14 h-14 rounded-md overflow-hidden border border-border shrink-0 hover:border-accent transition cursor-zoom-in"
                            title={img.label}
                          >
                            <img
                              src={img.url}
                              alt={img.label}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] px-1 py-0.5 truncate">
                              {img.label}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {m.audioCandidates && m.audioCandidates.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs text-text-secondary">{t.zp_video_confirm_audio}</div>
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setMessages((prev) =>
                              prev.map((x) =>
                                x.id === m.id && x.kind === "video_confirm"
                                  ? { ...x, selectedAudioUrl: "" }
                                  : x,
                              ),
                            )
                          }
                          className={`text-left text-xs px-2 py-1 rounded border transition ${
                            !m.selectedAudioUrl
                              ? "border-accent text-accent bg-accent/5"
                              : "border-border text-text-muted hover:border-accent"
                          }`}
                        >
                          {t.zp_video_confirm_audio_none}
                        </button>
                        {m.audioCandidates.map((ac) => (
                          <div
                            key={ac.characterId}
                            className={`flex items-center gap-2 px-2 py-1 rounded border transition ${
                              m.selectedAudioUrl === ac.audioUrl
                                ? "border-accent bg-accent/5"
                                : "border-border"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setMessages((prev) =>
                                  prev.map((x) =>
                                    x.id === m.id && x.kind === "video_confirm"
                                      ? { ...x, selectedAudioUrl: ac.audioUrl }
                                      : x,
                                  ),
                                )
                              }
                              className={`text-xs shrink-0 ${
                                m.selectedAudioUrl === ac.audioUrl
                                  ? "text-accent font-medium"
                                  : "text-text-secondary"
                              }`}
                            >
                              {ac.characterName}
                            </button>
                            <audio controls src={ac.audioUrl} className="h-6 flex-1 min-w-0" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <details className="group">
                    <summary className="text-xs text-accent cursor-pointer select-none inline-flex items-center gap-1">
                      <ChevronDown
                        size={10}
                        className="group-open:rotate-180 transition shrink-0"
                      />
                      {t.zp_video_confirm_show_prompt}
                    </summary>
                    {m.images.length > 0 && m.status !== "generating" && (
                      <div className="mt-1 space-y-1">
                        <button
                          type="button"
                          onClick={() =>
                            setMentionPickerFor(mentionPickerFor === m.id ? null : m.id)
                          }
                          className="text-[11px] text-text-secondary hover:text-accent inline-flex items-center gap-1 border border-border rounded-md px-2 py-0.5 hover:border-accent transition"
                          title="在光标位置插入参考图引用"
                        >
                          <AtSign size={11} /> 插入参考图
                        </button>
                        {mentionPickerFor === m.id && (
                          <div className="flex flex-wrap gap-1.5 p-2 rounded-md border border-accent/40 bg-bg-elevated">
                            {m.images.map((img, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => insertRefAtCursor(m.id, img.label)}
                                className="relative w-12 h-12 rounded-md overflow-hidden border border-border hover:border-accent transition shrink-0"
                                title={`插入 [${img.label}]`}
                              >
                                <img
                                  src={img.url}
                                  alt={img.label}
                                  className="w-full h-full object-cover"
                                />
                                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] px-0.5 truncate">
                                  {img.label}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div
                      ref={(el) => {
                        if (el) {
                          promptDivRefs.current.set(m.id, el);
                          // 非受控:首次挂载时初始化内容(dataset 防重复)
                          if (!el.dataset.initialized) {
                            el.innerText = m.previewPrompt;
                            el.dataset.initialized = "true";
                          }
                        } else {
                          promptDivRefs.current.delete(m.id);
                        }
                      }}
                      contentEditable={m.status !== "generating"}
                      suppressContentEditableWarning
                      onInput={(e) => {
                        // 必须同步取值:React 的 state updater 在并发渲染下会
                        // 延迟执行,届时合成事件的 currentTarget 已被重置为
                        // null,在 updater 里读 e.currentTarget.innerText 会抛
                        // "Cannot read properties of null" 导致整个面板崩溃。
                        const text = e.currentTarget.innerText;
                        setMessages((prev) =>
                          prev.map((x) =>
                            x.id === m.id && x.kind === "video_confirm"
                              ? { ...x, previewPrompt: text }
                              : x,
                          ),
                        );
                      }}
                      className="mt-1 w-full max-h-[240px] min-h-[120px] overflow-y-auto whitespace-pre-wrap break-words text-xs text-text-secondary bg-bg-surface border border-border rounded-md p-2 font-mono leading-relaxed focus:border-accent focus:outline-none cursor-text"
                    />
                  </details>
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    {(m.status === "pending" || m.status === "failed") && (
                      <>
                        <button
                          onClick={() =>
                            handleConfirmVideo(
                              m.id,
                              m.groupId,
                              m.method,
                              m.previewPrompt,
                              m.selectedAudioUrl,
                            )
                          }
                          className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-semibold hover:opacity-90 inline-flex items-center gap-1"
                        >
                          <Sparkles size={12} /> {t.zp_video_confirm_gen}
                        </button>
                        {m.status === "pending" && (
                          <button
                            onClick={() =>
                              setMessages((prev) =>
                                prev.map((x) =>
                                  x.id === m.id && x.kind === "video_confirm"
                                    ? { ...x, status: "cancelled" as const }
                                    : x,
                                ),
                              )
                            }
                            className="px-3 py-1.5 rounded-md border border-border text-xs text-text-secondary hover:border-accent"
                          >
                            {t.zp_video_confirm_cancel}
                          </button>
                        )}
                        {m.status === "failed" && (
                          <button
                            type="button"
                            onClick={() => {
                              // 卡在 running(callGenVideo hang)时点"确认生成"会被拦截,
                              // 这里先清掉 running + 自增轮次,卡片回 pending,可重新生成
                              setMessages((prev) =>
                                prev.map((x) =>
                                  x.id === m.id && x.kind === "video_confirm"
                                    ? { ...x, status: "pending" as const }
                                    : x,
                                ),
                              );
                              onCancelVideoGen?.(m.groupId);
                            }}
                            className="px-3 py-1.5 rounded-md border border-border text-xs text-text-secondary hover:border-rose-400 hover:text-rose-400 transition"
                            title="清除卡住的生成状态,回到可重新生成的待确认状态"
                          >
                            {t.zp_video_confirm_reset}
                          </button>
                        )}
                      </>
                    )}
                    {m.status === "generating" && (
                      <span className="text-xs text-text-secondary inline-flex items-center gap-2">
                        <span className="inline-flex items-center gap-1">
                          <Loader2 size={12} className="animate-spin" />
                          {t.zp_video_confirm_generating}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setMessages((prev) =>
                              prev.map((x) =>
                                x.id === m.id && x.kind === "video_confirm"
                                  ? { ...x, status: "pending" as const }
                                  : x,
                              ),
                            );
                            onCancelVideoGen?.(m.groupId);
                          }}
                          className="px-2 py-1 rounded-md border border-border text-xs text-text-secondary hover:border-rose-400 hover:text-rose-400 transition inline-flex items-center gap-1"
                        >
                          <X size={11} /> {t.zp_video_confirm_abort}
                        </button>
                      </span>
                    )}
                    {m.status === "done" && (
                      <span className="text-xs text-emerald-400 inline-flex items-center gap-1">
                        <Check size={12} /> {t.zp_video_confirm_done}
                      </span>
                    )}
                    {m.status === "failed" && (
                      <span className="text-xs text-rose-400 inline-flex items-center gap-1">
                        <AlertTriangle size={12} /> {t.zp_video_confirm_failed}
                      </span>
                    )}
                    {m.status === "cancelled" && (
                      <span className="text-xs text-text-muted">
                        {t.zp_video_confirm_cancelled}
                      </span>
                    )}
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id} className="space-y-2">
                {m.steps.map((s, i) => {
                  const done = i < m.doneCount;
                  const active = i === m.doneCount && !m.summary;
                  return (
                    <div
                      key={i}
                      onClick={() => {
                        if (m.stage) onJumpStage(m.stage);
                      }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition cursor-pointer ${done ? "border-border bg-bg-elevated/60" : "border-border bg-bg-elevated/30"} hover:border-accent/40`}
                    >
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${done ? "bg-emerald-500/20 text-emerald-400" : "bg-bg-surface text-text-muted"}`}
                      >
                        {done ? (
                          <Check size={12} />
                        ) : active ? (
                          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                        ) : null}
                      </span>
                      <span className={done ? "text-text-primary" : "text-text-muted"}>{s}</span>
                    </div>
                  );
                })}
                {m.summary && (
                  <div className="space-y-2 pt-1">
                    <p className="text-sm text-text-primary">{m.summary.title}</p>
                    <p className="text-sm text-text-secondary leading-relaxed">
                      {m.summary.detail}
                    </p>
                    <p className="text-sm text-text-secondary leading-relaxed">{m.summary.next}</p>
                  </div>
                )}
                {m.ctas && (
                  <div className="space-y-2 pt-2 relative">
                    {m.ctas.slice(0, ctasCollapsed ? 1 : undefined).map((c, idx) => (
                      <button
                        key={c.key}
                        onClick={() => handleCta(c)}
                        className={`w-full px-4 py-3 rounded-lg border text-sm font-semibold transition ${
                          idx === 0
                            ? "bg-accent-dim/40 border-accent text-text-primary hover:bg-accent-dim/60"
                            : "bg-bg-elevated border-border hover:border-accent"
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                    <button
                      onClick={() => setCtasCollapsed((v) => !v)}
                      className="absolute right-1 -top-1 w-6 h-6 rounded-full bg-bg-elevated border border-border flex items-center justify-center text-text-muted hover:text-accent"
                    >
                      {ctasCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* CTA parameter sheet */}
      {pendingCta &&
        (pendingCta.previewing ? (
          <div className="mx-3 mb-2 rounded-xl border border-accent/50 bg-bg-elevated p-3 shrink-0 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-text-primary inline-flex items-center gap-1">
                  <Sparkles size={12} className="text-accent" /> {t.zp_preview_title}
                </div>
                <p className="text-xs text-text-muted mt-0.5">{t.zp_preview_desc}</p>
              </div>
              <button
                onClick={() => setPendingCta(null)}
                className="text-text-muted hover:text-text-primary -mt-1"
                title={t.zp_param_cancel}
              >
                <X size={14} />
              </button>
            </div>
            <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap break-words text-xs text-text-secondary bg-bg-surface border border-border rounded-md p-2 font-mono leading-relaxed">
              {buildPrompt(
                pendingCta.spec,
                pendingCta.values,
                stageTag(pendingCta.cta, pendingCta.spec.targetStage),
              )}
            </pre>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setPendingCta((p) => (p ? { ...p, previewing: false } : p))}
                className="px-3 py-1.5 rounded-md border border-border text-xs text-text-secondary hover:border-accent"
              >
                {t.zp_preview_back}
              </button>
              <button
                onClick={confirmPendingCta}
                className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-semibold hover:opacity-90"
              >
                {t.zp_preview_send}
              </button>
            </div>
          </div>
        ) : (
          <div className="mx-3 mb-2 rounded-xl border border-accent/50 bg-bg-elevated p-3 shrink-0 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-text-primary inline-flex items-center gap-1">
                  <Sparkles size={12} className="text-accent" /> {t.zp_param_title}
                </div>
                <p className="text-xs text-text-muted mt-0.5">{t.zp_param_desc}</p>
              </div>
              <button
                onClick={() => setPendingCta(null)}
                className="text-text-muted hover:text-text-primary -mt-1"
                title={t.zp_param_cancel}
              >
                <X size={14} />
              </button>
            </div>
            <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
              {pendingCta.spec.fields.map((f) => (
                <div key={f.key} className="space-y-1">
                  <div className="text-xs text-text-secondary">{f.label}</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {f.options.map((o) => {
                      const val = pendingCta.values[f.key];
                      const isMulti = f.multiSelect;
                      const active = isMulti
                        ? Array.isArray(val) && val.includes(o.value)
                        : val === o.value;
                      if (o.locked) {
                        return (
                          <button
                            key={o.value}
                            onClick={() => setLockModal(o.label)}
                            className="px-2.5 py-1 rounded-full border border-border text-xs text-text-muted hover:border-rose-500/50 hover:text-rose-400 transition inline-flex items-center gap-1"
                          >
                            🔒 {o.label}
                          </button>
                        );
                      }
                      return (
                        <button
                          key={o.value}
                          onClick={() =>
                            setPendingCta((p) =>
                              p
                                ? {
                                    ...p,
                                    values: {
                                      ...p.values,
                                      [f.key]: isMulti
                                        ? Array.isArray(val)
                                          ? val.includes(o.value)
                                            ? val.filter((v: string) => v !== o.value)
                                            : [...val, o.value]
                                          : [o.value]
                                        : o.value,
                                    },
                                  }
                                : p,
                            )
                          }
                          className={`px-2.5 py-1 rounded-full border text-xs transition ${
                            active
                              ? "bg-accent-dim/60 border-accent text-text-primary"
                              : "bg-bg-surface border-border text-text-secondary hover:border-accent"
                          }`}
                        >
                          {o.label}
                        </button>
                      );
                    })}
                    {f.custom && (
                      <CustomNumberInput
                        value={(pendingCta.values[f.key] as string) ?? ""}
                        options={f.options}
                        onChange={(v) =>
                          setPendingCta((p) =>
                            p
                              ? {
                                  ...p,
                                  values: { ...p.values, [f.key]: v },
                                }
                              : p,
                          )
                        }
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setPendingCta(null)}
                className="px-3 py-1.5 rounded-md border border-border text-xs text-text-secondary hover:border-accent"
              >
                {t.zp_param_cancel}
              </button>
              <button
                onClick={() => setPendingCta((p) => (p ? { ...p, previewing: true } : p))}
                className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-semibold hover:opacity-90"
              >
                {t.zp_param_preview}
              </button>
            </div>
          </div>
        ))}

      {/* Upgrade hint */}
      {showUpgrade && (
        <div className="mx-3 mb-2 px-3 py-2 rounded-lg bg-accent-dim/40 border border-accent/40 text-xs flex items-center justify-between shrink-0">
          <span className="text-text-primary">✦ {t.zp_upgrade_hint}</span>
          <button
            onClick={() => setShowUpgrade(false)}
            className="text-text-muted hover:text-text-primary"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-border shrink-0">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => onFilesPicked(e.target.files)}
        />
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="group relative rounded-md border border-border bg-bg-elevated pl-2 pr-7 py-1 text-xs flex items-center gap-2 max-w-[180px]"
              >
                {a.url ? (
                  <img src={a.url} alt={a.name} className="w-6 h-6 object-cover rounded" />
                ) : (
                  <FileIcon size={12} className="text-text-muted shrink-0" />
                )}
                <span className="truncate">{a.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-bg-surface border border-border flex items-center justify-center text-text-muted hover:text-text-primary"
                  title={t.zp_remove_attachment}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        {(synopsisEditMode || episodeEditMode != null) && (
          <div className="mb-2 flex items-center justify-between px-3 py-2 rounded-lg bg-accent-dim/40 border border-accent/50 text-xs">
            <span className="text-accent inline-flex items-center gap-1">
              <Sparkles size={12} />
              {synopsisEditMode
                ? "正在修改故事梗概 — 输入修改意见后回车发送"
                : `正在修改第 ${episodeEditMode} 集剧本 — 输入修改意见后回车发送`}
            </span>
            <button
              onClick={() => {
                setSynopsisEditMode(false);
                setEpisodeEditMode(null);
              }}
              className="text-text-muted hover:text-text-primary"
            >
              <X size={12} />
            </button>
          </div>
        )}
        {pendingRef && (
          <div className="mb-2 flex items-center justify-between px-3 py-2 rounded-lg bg-accent-dim/40 border border-accent/50 text-xs">
            <span className="text-accent inline-flex items-center gap-2">
              <span className="w-5 h-5 rounded overflow-hidden shrink-0 bg-bg-surface">
                <img
                  src={pendingRef.imageUrl}
                  alt={pendingRef.label}
                  className="w-full h-full object-cover"
                />
              </span>
              修改
              {pendingRef.refType === "character"
                ? "角色"
                : pendingRef.refType === "scene"
                  ? "场景"
                  : "道具"}
              「{pendingRef.label}」— 输入修改意见后发送
            </span>
            <button
              onClick={() => {
                setPendingRef(null);
                setInput("");
              }}
              className="text-text-muted hover:text-text-primary"
            >
              <X size={12} />
            </button>
          </div>
        )}
        <div
          className={`rounded-xl border bg-bg-elevated focus-within:border-accent ${synopsisEditMode || episodeEditMode != null ? "border-accent/60" : "border-border"}`}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
              if (e.key === "Escape") {
                if (synopsisEditMode) setSynopsisEditMode(false);
                if (episodeEditMode != null) setEpisodeEditMode(null);
              }
            }}
            rows={2}
            placeholder={
              locked
                ? t.zp_input_placeholder_locked
                : synopsisEditMode
                  ? "输入修改意见，例如：把女主角改成更强势的性格，增加悬疑元素…"
                  : episodeEditMode != null
                    ? `输入对第 ${episodeEditMode} 集的修改意见，例如：加强结尾悬念，让对白更紧凑…`
                    : t.zp_input_placeholder
            }
            disabled={locked}
            className={`w-full bg-transparent px-3 py-2 text-sm resize-none focus:outline-none placeholder:text-text-muted disabled:text-text-muted ${synopsisEditMode || episodeEditMode != null ? "placeholder:text-accent/60" : ""}`}
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-8 h-8 rounded-md bg-bg-surface border border-border flex items-center justify-center text-text-muted hover:text-accent"
              title={t.zp_attach}
            >
              <Paperclip size={14} />
            </button>
            <button
              onClick={() => send(input)}
              disabled={(!input.trim() && attachments.length === 0) || locked}
              className="w-9 h-9 rounded-full bg-accent text-accent-foreground flex items-center justify-center disabled:opacity-40 hover:opacity-90"
              title={t.zp_send}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>

      {pendingReferenceCost && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-bg-surface border border-border rounded-2xl shadow-2xl max-w-sm w-full p-5 space-y-3">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-300 font-semibold">
              <AlertTriangle size={18} /> 确认消耗积分
            </div>
            <p className="text-sm text-text-secondary leading-relaxed">
              将按你的意见重生成「{pendingReferenceCost.ref.label}」的参考图，此操作会消耗积分。
            </p>
            <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={skipCreditConfirmation}
                onChange={(event) => setProjectCreditConfirmationPreference(event.target.checked)}
                className="accent-accent"
              />
              本项目后续积分操作不再提醒
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingReferenceCost(null)}
                className="px-3 py-1.5 rounded border border-border text-sm text-text-secondary hover:border-accent"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => executeReferenceModification(pendingReferenceCost.ref, pendingReferenceCost.instruction)}
                className="px-3 py-1.5 rounded bg-accent text-accent-foreground text-sm font-semibold hover:opacity-90"
              >
                确认重生成
              </button>
            </div>
          </div>
        </div>
      )}

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
              <h3 className="font-display text-lg font-bold text-text-primary">题材解锁申请</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                「{lockModal}
                」为用户定制题材，请您在遵守所在地区法律法规的前提下，向管理员申请解锁该题材。
              </p>
            </div>
            <button
              onClick={() => setLockModal(null)}
              className="w-full py-2.5 rounded-lg bg-accent text-accent-foreground text-sm font-semibold hover:opacity-90 transition"
            >
              我知道了
            </button>
          </div>
        </div>
      )}

      {/* 2026/07:参考图 lightbox —— 点确认卡片缩略图放大,点遮罩 / X 关闭,点图片不关闭 */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-md bg-bg-surface/80 border border-border text-text-secondary hover:text-text-primary"
            title="关闭"
          >
            <X size={20} />
          </button>
          <img
            src={lightboxUrl}
            alt="预览"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Import script modal — full-viewport overlay. Bypasses the chat workflow; the
          workspace state is written via the onImportScript prop callback. */}
      {importModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeImportModal}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative bg-bg-surface border border-border rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <h2 className="font-display text-lg font-bold inline-flex items-center gap-2">
                <Upload size={18} className="text-accent" /> {t.zp_cta_import_script}
              </h2>
              <button
                type="button"
                onClick={closeImportModal}
                disabled={importModal.stage === "parsing"}
                className="p-1.5 rounded-md hover:bg-bg-elevated text-text-muted disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label={t.zp_import_cancel}
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
              {importModal.stage === "parsing" ? (
                <div className="py-12 flex flex-col items-center gap-3 text-text-muted">
                  <Loader2 size={32} className="animate-spin text-accent" />
                  {/* 实时显示 server fn 各阶段 yield 的 progress 事件，
                    替换原来的静态 "正在解析..." 文案 */}
                  <p className="text-sm text-text-secondary min-h-[1.25rem] text-center px-4">
                    {importModal.progress}
                  </p>
                  <p className="text-xs text-text-muted">{t.zp_import_parsing_hint}</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-text-secondary leading-relaxed">{t.zp_import_hint}</p>

                  {/* Drag-drop / click-to-pick area */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setImportDragging(true);
                    }}
                    onDragLeave={() => setImportDragging(false)}
                    onDrop={onImportFileDropped}
                    onClick={() => importFileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") importFileInputRef.current?.click();
                    }}
                    className={`rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm cursor-pointer transition ${
                      importDragging
                        ? "border-accent bg-accent-dim/30"
                        : "border-border hover:border-accent text-text-muted"
                    }`}
                  >
                    {importModal.stage === "paste" && importModal.fileName ? (
                      <span className="text-text-primary inline-flex items-center gap-2">
                        <FileText size={18} className="text-accent shrink-0" />
                        <span className="truncate">
                          {t.zp_import_drop_loaded}
                          {importModal.fileName}
                        </span>
                      </span>
                    ) : (
                      <span className="inline-flex flex-col items-center gap-1">
                        <FileText size={28} className="text-text-muted" />
                        <span>
                          {t.zp_import_drop_idle}
                          <span className="text-accent underline ml-1">
                            {t.zp_import_drop_click}
                          </span>
                        </span>
                      </span>
                    )}
                    <input
                      ref={importFileInputRef}
                      type="file"
                      accept=".docx,.txt"
                      className="hidden"
                      onChange={onImportFilePickedEvent}
                    />
                  </div>

                  <div className="flex items-center gap-3 text-xs text-text-muted">
                    <div className="flex-1 h-px bg-border" />
                    <span>{t.zp_import_paste_label}</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  <textarea
                    value={importModal.stage === "paste" ? importModal.text : ""}
                    onChange={(e) => {
                      if (importModal.stage !== "paste") return;
                      setImportModal({ ...importModal, text: e.target.value, fileName: null });
                    }}
                    rows={10}
                    placeholder={t.zp_import_paste_placeholder}
                    className="w-full rounded-lg bg-bg-elevated border border-border text-sm font-mono p-3 resize-y focus:border-accent focus:outline-none"
                    style={{ minHeight: 200, maxHeight: 360 }}
                  />

                  {importModal.stage === "error" && (
                    <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-sm text-rose-400">
                      {importModal.message}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            {importModal.stage !== "parsing" && (
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
                <button
                  onClick={closeImportModal}
                  className="px-3 py-1.5 rounded-md border border-border text-xs text-text-secondary hover:border-accent transition"
                >
                  {t.zp_import_cancel}
                </button>
                <button
                  onClick={onImportSubmit}
                  disabled={importModal.stage !== "paste" || importModal.text.trim().length < 20}
                  className="px-4 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {t.zp_import_submit}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
});

export default ZopiaChatPanel;

// 自定义数字输入框:与 quick-pick options 并排展示。
// 关键修复:之前用受控 input + "若 value 在 options 里就清空" 的渲染会吞数字 ——
// 用户先输入 "3" 让 value 变成 options 命中值,input 被强制清空,再输入 "0"
// 就只剩 "0",所以 "30/50/70/90" 都打不进去。这里用独立的本地 text state 跟
// isTypingRef 区分"用户在打字"和"外部点了 button",前者不重置,后者(命中 option)
// 才清空,允许输入任意多位数字。
function CustomNumberInput({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const isOption = (v: string) => options.some((o) => o.value === v);
  const [text, setText] = useState<string>(() => (isOption(value) ? "" : value));
  const isTypingRef = useRef(false);
  useEffect(() => {
    // 自己刚 onChange 引起的 value 变化:跳过,保留 input 文本
    if (isTypingRef.current) {
      isTypingRef.current = false;
      return;
    }
    // 外部(点 quick-pick button)把 value 设到某个 option:input 让位给 button 高亮
    if (isOption(value)) {
      if (text !== "") setText("");
    } else if (value !== text) {
      setText(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={text}
      placeholder="自定义"
      onChange={(e) => {
        const v = e.target.value;
        if (v !== "" && !/^\d+$/.test(v)) return;
        isTypingRef.current = true;
        setText(v);
        onChange(v);
      }}
      className="w-16 px-2 py-1 rounded-md border border-border bg-bg-surface text-xs text-text-primary focus:border-accent focus:outline-none placeholder:text-text-muted"
    />
  );
}
