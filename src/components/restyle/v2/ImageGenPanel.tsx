// ====================================================================
//  转绘 v2 阶段 B（第二步）—— 造型化生图面板
//
//  四个区块，全部接 ArtifactApprovalPanel 确认关卡：
//   1. 换装区间：planCharacterLooksFn 规划 → looks 表 → 产物确认
//      （confirmCharacterLooksFn，userContent.looks 回写 looks 表）。
//   2. 生图提示词：planImagePromptsFn 组装（主图+三视图+逐 look 正/背/侧）
//      → 提示词确认关卡，未 user_approved 服务端拒绝真实生图。
//   3. 角色×造型卡片：主图/三视图/look 图缩略、生成中/完成/失败态、
//      单角色重跑；生成前先弹「总张数 + 预计积分」确认弹窗
//      （estimateCharacterImagesFn）再调 generateCharacterImagesFn。
//   4. 音色方案：按重要度排序的方案表；「生成音色参考视频」仅重点角色
//      可见，点击先弹范围+预计积分确认，确认后调 generateVoiceReferenceVideoFn。
// ====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  confirmCharacterLooksFn,
  confirmVoicePlanFn,
  estimateCharacterImagesFn,
  generateCharacterImagesFn,
  generateVoiceReferenceVideoFn,
  listImageGenFn,
  planCharacterLooksFn,
  planImagePromptsFn,
  planVoiceProfilesFn,
} from "@/lib/restyle/restyleImageGen.functions";
import { approveArtifactFn, rejectArtifactFn } from "@/lib/restyle/restyleArtifacts.functions";
import ArtifactApprovalPanel, { type ArtifactIssue } from "./ArtifactApprovalPanel";

const IMAGE_GEN_STAGE = "image_gen";
const LOOKS_NODE_KEY = "looks";
const PROMPTS_NODE_KEY = "prompts";
const VOICE_PLAN_STAGE = "voice_plan";
const VOICE_NODE_KEY = "project";

interface VoiceProfile {
  tier?: string;
  importanceRank?: number;
  shotCount?: number;
  groupCount?: number;
  voiceDescription?: string;
  referenceEmotion?: string;
  plan?: string;
  referenceVideoUrl?: string | null;
}

interface CharacterRow {
  id: string;
  name: string;
  identity_lock: string | null;
  clothing: string | null;
  main_image_url: string | null;
  turnaround_url: string | null;
  voice_profile: VoiceProfile | null;
  status: string;
}

interface LookRow {
  id: string;
  character_id: string;
  name: string;
  from_shot: string | null;
  to_shot: string | null;
  redesign_reason: string | null;
  reuse_existing: boolean | null;
  reuse_source: string | null;
  front_url: string | null;
  back_url: string | null;
  side_url: string | null;
  image_url: string | null;
}

interface ArtifactInfo {
  status: string;
  verdict: string | null;
  issues: unknown;
  content: unknown;
  user_content: unknown;
  revision: number;
}

interface ImageGenData {
  characters: CharacterRow[];
  looks: LookRow[];
  looksArtifact: ArtifactInfo | null;
  promptsArtifact: ArtifactInfo | null;
  voiceArtifact: ArtifactInfo | null;
  voiceReferenceVideo: {
    model: string;
    durationSec: number;
    resolution: string;
    estimatedCreditsPerVideo: number | null;
  };
}

interface ImageEstimate {
  totalImages: number;
  perImageCredits: number | null;
  totalCredits: number | null;
}

export interface ImageGenPanelProps {
  projectId: string;
  /** 产物状态变化后回调（上层刷新阶段闸门）。 */
  onArtifactsChanged?: () => void;
}

function Thumb({ url, label }: { url: string | null; label: string }) {
  return (
    <div className="w-20 shrink-0">
      <div className="flex h-28 items-center justify-center overflow-hidden rounded-md border border-border bg-bg-elevated">
        {url ? (
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span className="px-1 text-center text-[10px] text-text-muted">未生成</span>
        )}
      </div>
      <p className="mt-1 text-center text-[10px] text-text-muted">{label}</p>
    </div>
  );
}

function ArtifactBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px]",
        status === "user_approved"
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
          : status === "rejected"
            ? "border-red-500/40 bg-red-500/10 text-red-400"
            : "border-border bg-bg-elevated text-text-muted",
      )}
    >
      {status}
    </Badge>
  );
}

function creditsText(total: number | null, per: number | null): string {
  if (total === null || per === null) return "当前生图模型未计价，不消耗积分";
  return `预计消耗 ${total} 积分（${per}/张）`;
}

export default function ImageGenPanel({ projectId, onArtifactsChanged }: ImageGenPanelProps) {
  const callList = useServerFn(listImageGenFn);
  const callPlanLooks = useServerFn(planCharacterLooksFn);
  const callConfirmLooks = useServerFn(confirmCharacterLooksFn);
  const callPlanPrompts = useServerFn(planImagePromptsFn);
  const callEstimate = useServerFn(estimateCharacterImagesFn);
  const callGenerate = useServerFn(generateCharacterImagesFn);
  const callPlanVoice = useServerFn(planVoiceProfilesFn);
  const callConfirmVoice = useServerFn(confirmVoicePlanFn);
  const callVoiceVideo = useServerFn(generateVoiceReferenceVideoFn);
  const callApproveArtifact = useServerFn(approveArtifactFn);
  const callRejectArtifact = useServerFn(rejectArtifactFn);

  const [data, setData] = useState<ImageGenData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingNodes, setPendingNodes] = useState<string[]>([]);
  const [planningLooks, setPlanningLooks] = useState(false);
  const [planningPrompts, setPlanningPrompts] = useState(false);
  const [planningVoice, setPlanningVoice] = useState(false);
  const [acting, setActing] = useState(false);

  /** 生图确认弹窗：characterIds 为空数组 = 全部角色。 */
  const [genDialog, setGenDialog] = useState<{
    characterIds: string[];
    estimate: ImageEstimate;
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  /** 单角色/整批生成状态：characterId 集合（生成中）。 */
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  /** 上一轮失败记录：characterId → 失败信息列表。 */
  const [failuresByCharacter, setFailuresByCharacter] = useState<Map<string, string[]>>(new Map());

  /** 音色参考视频确认弹窗。 */
  const [voiceDialog, setVoiceDialog] = useState<CharacterRow | null>(null);
  const [voiceVideoBusy, setVoiceVideoBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await callList({ data: { projectId } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setData(result.data as unknown as ImageGenData);
    } finally {
      setLoading(false);
    }
  }, [callList, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const looksByCharacter = useMemo(() => {
    const map = new Map<string, LookRow[]>();
    for (const look of data?.looks ?? []) {
      const list = map.get(look.character_id) ?? [];
      list.push(look);
      map.set(look.character_id, list);
    }
    return map;
  }, [data]);

  const sortedCharacters = useMemo(() => {
    const rows = [...(data?.characters ?? [])];
    return rows.sort(
      (a, b) =>
        (a.voice_profile?.importanceRank ?? 999) - (b.voice_profile?.importanceRank ?? 999),
    );
  }, [data]);

  const handleStageError = (result: { code?: string; pending?: string[] }): result is { code: "STAGE_NOT_APPROVED"; pending: string[] } => {
    if (result.code === "STAGE_NOT_APPROVED") {
      setPendingNodes(result.pending ?? []);
      setError("前置节点未确认（STAGE_NOT_APPROVED）。");
      return true;
    }
    return false;
  };

  // ------------------------------------------------------------------
  // 换装区间
  // ------------------------------------------------------------------

  const handlePlanLooks = async () => {
    setPlanningLooks(true);
    setError(null);
    try {
      const result = await callPlanLooks({ data: { projectId } });
      if (result.ok) {
        setPendingNodes([]);
        toast.success(`换装区间规划完成：${result.lookCount} 条 look，请确认后进入提示词环节。`);
        await refresh();
        onArtifactsChanged?.();
      } else if (!handleStageError(result)) {
        setError(result.error ?? "换装区间规划失败。");
      }
    } finally {
      setPlanningLooks(false);
    }
  };

  const handleConfirmLooks = async (userContent?: unknown) => {
    setActing(true);
    try {
      const result = await callConfirmLooks({
        data: { projectId, ...(userContent !== undefined ? { userContent } : {}) },
      });
      if (!result.ok) {
        toast.error(result.error ?? "确认失败。");
        return;
      }
      toast.success("换装方案已确认。");
      await refresh();
      onArtifactsChanged?.();
    } finally {
      setActing(false);
    }
  };

  const handleRejectArtifact = async (stage: string, nodeKey: string, feedback: string) => {
    setActing(true);
    try {
      const result = await callRejectArtifact({ data: { projectId, stage, nodeKey, feedback } });
      if (!result.ok) {
        toast.error(result.error ?? "打回失败。");
        return;
      }
      toast.success("已打回，可重新生成。");
      await refresh();
      onArtifactsChanged?.();
    } finally {
      setActing(false);
    }
  };

  // ------------------------------------------------------------------
  // 生图提示词 + 生图
  // ------------------------------------------------------------------

  const handlePlanPrompts = async () => {
    setPlanningPrompts(true);
    setError(null);
    try {
      const result = await callPlanPrompts({ data: { projectId } });
      if (result.ok) {
        setPendingNodes([]);
        toast.success(`已组装 ${result.itemCount} 条生图提示词，请逐条确认后再生成图片。`);
        await refresh();
        onArtifactsChanged?.();
      } else if (!handleStageError(result)) {
        setError(result.error ?? "提示词组装失败。");
      }
    } finally {
      setPlanningPrompts(false);
    }
  };

  const handleApprovePrompts = async (userContent?: unknown) => {
    setActing(true);
    try {
      const result = await callApproveArtifact({
        data: {
          projectId,
          stage: IMAGE_GEN_STAGE,
          nodeKey: PROMPTS_NODE_KEY,
          ...(userContent !== undefined ? { userContent } : {}),
        },
      });
      if (!result.ok) {
        toast.error(result.error ?? "确认失败。");
        return;
      }
      toast.success("生图提示词已确认，可以开始生成图片。");
      await refresh();
      onArtifactsChanged?.();
    } finally {
      setActing(false);
    }
  };

  /** 打开生图确认弹窗：先取积分预估，用户确认后才真实生图。 */
  const openGenerateDialog = async (characterIds: string[]) => {
    setError(null);
    const result = await callEstimate({
      data: { projectId, ...(characterIds.length > 0 ? { characterIds } : {}) },
    });
    if (!result.ok) {
      setError(result.error ?? "积分预估失败。");
      return;
    }
    setGenDialog({
      characterIds,
      estimate: {
        totalImages: result.totalImages,
        perImageCredits: result.perImageCredits,
        totalCredits: result.totalCredits,
      },
    });
  };

  const handleGenerate = async () => {
    if (!genDialog) return;
    const characterIds = genDialog.characterIds;
    setGenerating(true);
    setGeneratingIds(new Set(characterIds.length > 0 ? characterIds : (data?.characters ?? []).map((c) => c.id)));
    try {
      const result = await callGenerate({
        data: { projectId, ...(characterIds.length > 0 ? { characterIds } : {}) },
      });
      if (result.ok) {
        const failureMap = new Map<string, string[]>();
        for (const failure of result.failures) {
          const list = failureMap.get(failure.characterId) ?? [];
          list.push(`${failure.scope}: ${failure.error}`);
          failureMap.set(failure.characterId, list);
        }
        setFailuresByCharacter(failureMap);
        if (result.failures.length === 0) {
          toast.success(`图片生成完成：${result.generated}/${result.total} 张。`);
        } else {
          toast.warning(`生成 ${result.generated}/${result.total} 张，${result.failures.length} 张失败（详见角色卡片）。`);
        }
        setGenDialog(null);
        await refresh();
      } else if (handleStageError(result)) {
        toast.error("生图提示词尚未确认，无法生成图片。");
        setGenDialog(null);
      } else {
        toast.error(result.error ?? "图片生成失败。");
      }
    } finally {
      setGenerating(false);
      setGeneratingIds(new Set());
    }
  };

  // ------------------------------------------------------------------
  // 音色方案
  // ------------------------------------------------------------------

  const handlePlanVoice = async () => {
    setPlanningVoice(true);
    setError(null);
    try {
      const result = await callPlanVoice({ data: { projectId } });
      if (result.ok) {
        setPendingNodes([]);
        toast.success(`音色方案完成：${result.profileCount} 个角色（重点 ${result.majorCount} 个）。`);
        await refresh();
        onArtifactsChanged?.();
      } else if (!handleStageError(result)) {
        setError(result.error ?? "音色方案生成失败。");
      }
    } finally {
      setPlanningVoice(false);
    }
  };

  const handleConfirmVoice = async (userContent?: unknown) => {
    setActing(true);
    try {
      const result = await callConfirmVoice({
        data: { projectId, ...(userContent !== undefined ? { userContent } : {}) },
      });
      if (!result.ok) {
        toast.error(result.error ?? "确认失败。");
        return;
      }
      toast.success("音色方案已确认。");
      await refresh();
      onArtifactsChanged?.();
    } finally {
      setActing(false);
    }
  };

  const handleVoiceVideo = async () => {
    if (!voiceDialog) return;
    setVoiceVideoBusy(true);
    try {
      const result = await callVoiceVideo({
        data: { projectId, characterIds: [voiceDialog.id] },
      });
      if (result.ok) {
        if (result.generated > 0) {
          toast.success(`「${voiceDialog.name}」音色参考视频已生成。`);
        } else {
          toast.error(result.failures[0]?.error ?? "音色参考视频生成失败。");
        }
        setVoiceDialog(null);
        await refresh();
      } else if (handleStageError(result)) {
        toast.error("音色方案尚未确认，无法生成参考视频。");
        setVoiceDialog(null);
      } else {
        toast.error(result.error ?? "音色参考视频生成失败。");
      }
    } finally {
      setVoiceVideoBusy(false);
    }
  };

  // ------------------------------------------------------------------
  // 渲染
  // ------------------------------------------------------------------

  const looksApproved = data?.looksArtifact?.status === "user_approved";
  const promptsApproved = data?.promptsArtifact?.status === "user_approved";
  const voiceApproved = data?.voiceArtifact?.status === "user_approved";

  return (
    <div className="space-y-4">
      {pendingNodes.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="px-4 py-3">
            <p className="text-xs font-medium text-amber-400">
              前置阶段还有 {pendingNodes.length} 个节点未确认（STAGE_NOT_APPROVED）：
            </p>
            <ul className="mt-1 list-inside list-disc text-xs text-text-secondary">
              {pendingNodes.map((node) => (
                <li key={node}>{node}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* ① 换装区间 */}
      <Card className="border-border">
        <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">换装区间（角色 × 造型）</CardTitle>
            <ArtifactBadge status={data?.looksArtifact?.status} />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={planningLooks || loading || acting}
            onClick={() => void handlePlanLooks()}
          >
            {planningLooks ? "规划中…" : data?.looksArtifact ? "重新规划造型" : "规划造型（换装区间）"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4">
          {!data?.looksArtifact && (
            <p className="text-xs text-text-muted">
              由导演模型按角色人设 + 场景 + 分镜时间线推导换装区间（from_shot → to_shot）、
              换装理由与复用判定；方案确认后才组装生图提示词。
            </p>
          )}
          {(data?.looks.length ?? 0) > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {["角色", "造型", "区间", "换装理由", "复用"].map((col) => (
                      <th
                        key={col}
                        className="border-b border-border px-2 py-1.5 text-left font-medium text-text-muted"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data?.looks ?? []).map((look) => {
                    const character = data?.characters.find((c) => c.id === look.character_id);
                    return (
                      <tr key={look.id} className="border-b border-border/50 align-top">
                        <td className="px-2 py-1.5 text-text-secondary">{character?.name ?? "—"}</td>
                        <td className="px-2 py-1.5 text-text-secondary">{look.name}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-text-muted">
                          {look.from_shot ?? "—"} → {look.to_shot ?? "—"}
                        </td>
                        <td className="min-w-52 px-2 py-1.5 text-text-muted">
                          <span className="whitespace-pre-wrap">{look.redesign_reason ?? "—"}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          {look.reuse_existing ? (
                            <Badge
                              variant="outline"
                              className="border-sky-500/40 bg-sky-500/10 text-[10px] text-sky-400"
                            >
                              复用{look.reuse_source ? `：${look.reuse_source}` : ""}
                            </Badge>
                          ) : (
                            <span className="text-text-muted">新生成</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {data?.looksArtifact && (
            <ArtifactApprovalPanel
              verdict={data.looksArtifact.verdict}
              issues={(data.looksArtifact.issues ?? []) as ArtifactIssue[]}
              content={data.looksArtifact.content}
              userContent={data.looksArtifact.user_content}
              busy={acting || planningLooks}
              onApprove={(userContent) => handleConfirmLooks(userContent)}
              onReject={(feedback) => handleRejectArtifact(IMAGE_GEN_STAGE, LOOKS_NODE_KEY, feedback)}
            />
          )}
        </CardContent>
      </Card>

      {/* ② 生图提示词确认 */}
      <Card className="border-border">
        <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">生图提示词（逐条确认后才生成图片）</CardTitle>
            <ArtifactBadge status={data?.promptsArtifact?.status} />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!looksApproved || planningPrompts || loading || acting}
            onClick={() => void handlePlanPrompts()}
          >
            {planningPrompts ? "组装中…" : data?.promptsArtifact ? "重新组装提示词" : "组装生图提示词"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4">
          {!looksApproved && (
            <p className="text-xs text-text-muted">请先确认换装方案，再组装生图提示词。</p>
          )}
          {looksApproved && !data?.promptsArtifact && (
            <p className="text-xs text-text-muted">
              提示词由系统按 identity_lock + 服装 + 目标画风确定性组装（每角色主图 + 三视图，
              每个非复用造型主图 + 正/背/侧），确认/修改后才会真实调用生图。
            </p>
          )}
          {data?.promptsArtifact && (
            <ArtifactApprovalPanel
              verdict={data.promptsArtifact.verdict}
              issues={(data.promptsArtifact.issues ?? []) as ArtifactIssue[]}
              content={data.promptsArtifact.content}
              userContent={data.promptsArtifact.user_content}
              busy={acting || planningPrompts}
              onApprove={(userContent) => handleApprovePrompts(userContent)}
              onReject={(feedback) => handleRejectArtifact(IMAGE_GEN_STAGE, PROMPTS_NODE_KEY, feedback)}
            />
          )}
        </CardContent>
      </Card>

      {/* ③ 角色 × 造型卡片 */}
      <Card className="border-border">
        <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
          <CardTitle className="text-sm">角色图片（主图 + 三视图 + 造型图）</CardTitle>
          <Button
            type="button"
            size="sm"
            disabled={!promptsApproved || generating || loading}
            onClick={() => void openGenerateDialog([])}
          >
            {generating ? "生成中…" : "生成全部角色图片"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 px-4 pb-4">
          {!promptsApproved && (
            <p className="text-xs text-text-muted">提示词确认后才能生成图片。</p>
          )}
          {(data?.characters ?? []).map((character) => {
            const looks = looksByCharacter.get(character.id) ?? [];
            const failures = failuresByCharacter.get(character.id) ?? [];
            const isGenerating = generatingIds.has(character.id);
            return (
              <div key={character.id} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-secondary">{character.name}</span>
                    {isGenerating ? (
                      <Badge
                        variant="outline"
                        className="border-sky-500/40 bg-sky-500/10 text-[10px] text-sky-400"
                      >
                        生成中
                      </Badge>
                    ) : failures.length > 0 ? (
                      <Badge
                        variant="outline"
                        className="border-red-500/40 bg-red-500/10 text-[10px] text-red-400"
                      >
                        部分失败
                      </Badge>
                    ) : character.main_image_url ? (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-400"
                      >
                        完成
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-text-muted">
                        未生成
                      </Badge>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!promptsApproved || generating || acting}
                    onClick={() => void openGenerateDialog([character.id])}
                  >
                    {character.main_image_url ? "重跑该角色" : "生成该角色"}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Thumb url={character.main_image_url} label="主图" />
                  <Thumb url={character.turnaround_url} label="三视图" />
                  {looks.map((look) => (
                    <div key={look.id} className="flex gap-3 rounded-md border border-border/60 p-2">
                      <Thumb url={look.image_url} label={`${look.name}·主图`} />
                      <Thumb url={look.front_url} label="正面" />
                      <Thumb url={look.back_url} label="背面" />
                      <Thumb url={look.side_url} label="侧面" />
                    </div>
                  ))}
                </div>
                {failures.length > 0 && (
                  <ul className="mt-2 list-inside list-disc text-[11px] text-red-400">
                    {failures.map((failure, i) => (
                      <li key={i}>{failure}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ④ 音色方案 */}
      <Card className="border-border">
        <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">音色方案（按分镜数/分组数排重要度）</CardTitle>
            <ArtifactBadge status={data?.voiceArtifact?.status} />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={planningVoice || loading || acting}
            onClick={() => void handlePlanVoice()}
          >
            {planningVoice ? "生成中…" : data?.voiceArtifact ? "重新生成音色方案" : "生成音色方案"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4">
          {!data?.voiceArtifact && (
            <p className="text-xs text-text-muted">
              按分镜数/分组数排角色重要度；重点角色可生成音色参考视频（先确认范围与预计积分），
              次要角色建议上传音频或不固定音色。
            </p>
          )}
          {sortedCharacters.some((c) => c.voice_profile) && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {["#", "角色", "分镜数", "分组数", "重要度", "音色描述", "参考情绪", "方案", "操作"].map(
                      (col) => (
                        <th
                          key={col}
                          className="border-b border-border px-2 py-1.5 text-left font-medium text-text-muted"
                        >
                          {col}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sortedCharacters
                    .filter((c) => c.voice_profile)
                    .map((character) => {
                      const profile = character.voice_profile!;
                      const major = profile.tier === "重点";
                      return (
                        <tr key={character.id} className="border-b border-border/50 align-top">
                          <td className="px-2 py-1.5 text-text-muted">{profile.importanceRank ?? "—"}</td>
                          <td className="px-2 py-1.5 text-text-secondary">{character.name}</td>
                          <td className="px-2 py-1.5 text-text-muted">{profile.shotCount ?? 0}</td>
                          <td className="px-2 py-1.5 text-text-muted">{profile.groupCount ?? 0}</td>
                          <td className="px-2 py-1.5">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                major
                                  ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                                  : "border-border bg-bg-elevated text-text-muted",
                              )}
                            >
                              {profile.tier ?? "—"}
                            </Badge>
                          </td>
                          <td className="min-w-40 px-2 py-1.5 text-text-muted">
                            {profile.voiceDescription || "—"}
                          </td>
                          <td className="px-2 py-1.5 text-text-muted">
                            {profile.referenceEmotion || "—"}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-text-muted">
                            {profile.plan === "reference_video"
                              ? profile.referenceVideoUrl
                                ? "参考视频已生成"
                                : "生成参考视频"
                              : profile.plan === "upload_audio"
                                ? "上传音频"
                                : "不固定音色"}
                          </td>
                          <td className="px-2 py-1.5">
                            {major && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[11px]"
                                disabled={!voiceApproved || voiceVideoBusy || !character.main_image_url}
                                onClick={() => setVoiceDialog(character)}
                              >
                                {profile.referenceVideoUrl ? "重新生成参考视频" : "生成音色参考视频"}
                              </Button>
                            )}
                            {profile.referenceVideoUrl && (
                              <a
                                href={profile.referenceVideoUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-2 text-[11px] text-sky-400 underline"
                              >
                                查看
                              </a>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
          {data?.voiceArtifact && (
            <ArtifactApprovalPanel
              verdict={data.voiceArtifact.verdict}
              issues={(data.voiceArtifact.issues ?? []) as ArtifactIssue[]}
              content={data.voiceArtifact.content}
              userContent={data.voiceArtifact.user_content}
              busy={acting || planningVoice}
              onApprove={(userContent) => handleConfirmVoice(userContent)}
              onReject={(feedback) => handleRejectArtifact(VOICE_PLAN_STAGE, VOICE_NODE_KEY, feedback)}
            />
          )}
        </CardContent>
      </Card>

      {/* 生图积分确认弹窗 */}
      <Dialog open={genDialog !== null} onOpenChange={(open) => !open && setGenDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认生成图片</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-text-secondary">
            <p>
              范围：
              {genDialog && genDialog.characterIds.length > 0
                ? `所选 ${genDialog.characterIds.length} 个角色`
                : "全部角色"}
              ，共 {genDialog?.estimate.totalImages ?? 0} 张图。
            </p>
            <p>
              {creditsText(
                genDialog?.estimate.totalCredits ?? null,
                genDialog?.estimate.perImageCredits ?? null,
              )}
              ；成功一张扣一张，失败不扣。
            </p>
            <p className="text-xs text-text-muted">
              逐张串行生成，每张最长约 6 分钟；期间请勿关闭页面。
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={generating}
              onClick={() => setGenDialog(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={generating || (genDialog?.estimate.totalImages ?? 0) === 0}
              onClick={() => void handleGenerate()}
            >
              {generating ? "生成中…" : "确认生成"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 音色参考视频确认弹窗 */}
      <Dialog open={voiceDialog !== null} onOpenChange={(open) => !open && setVoiceDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>生成音色参考视频</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-text-secondary">
            <p>范围：「{voiceDialog?.name}」1 个重点角色。</p>
            <p>
              预计消耗{" "}
              {data?.voiceReferenceVideo.estimatedCreditsPerVideo === null
                ? "0 积分（当前视频模型未计价）"
                : `${data?.voiceReferenceVideo.estimatedCreditsPerVideo} 积分`}
              （{data?.voiceReferenceVideo.model} · {data?.voiceReferenceVideo.durationSec}s ·{" "}
              {data?.voiceReferenceVideo.resolution}，图生视频 + 出声）。
            </p>
            <p className="text-xs text-text-muted">
              音色：{voiceDialog?.voice_profile?.voiceDescription || "—"}；参考情绪：
              {voiceDialog?.voice_profile?.referenceEmotion || "—"}。
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={voiceVideoBusy}
              onClick={() => setVoiceDialog(null)}
            >
              取消
            </Button>
            <Button type="button" disabled={voiceVideoBusy} onClick={() => void handleVoiceVideo()}>
              {voiceVideoBusy ? "生成中…" : "确认生成"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
