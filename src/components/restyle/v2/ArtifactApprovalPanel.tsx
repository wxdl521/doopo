// ====================================================================
//  转绘 v2 —— 统一产物确认组件 ArtifactApprovalPanel（需求文档第五节）
//
//  布局：左列 AI 检查结论（verdict 徽标 + issues 列表，severity 颜色区分），
//  右列可编辑产物（JSON textarea + 格式校验）。
//  操作：「采纳 AI 版本」（不改写，直接确认）/「保存修改并提交」（userContent）
//  /「打回重生成（附意见）」。
//  content 为数组时支持逐条编辑、逐条确认 + 「全部通过」。
// ====================================================================

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface ArtifactIssue {
  severity?: string;
  type?: string;
  description?: string;
  [key: string]: unknown;
}

export interface ArtifactApprovalPanelProps {
  verdict?: string | null;
  issues?: ArtifactIssue[];
  /** AI 产出内容（永不覆写）。 */
  content: unknown;
  /** 用户改写；null/undefined 表示未改。 */
  userContent?: unknown;
  /** 确认；带 userContent 表示「保存修改并提交」，不带表示「采纳 AI 版本」。 */
  onApprove: (userContent?: unknown) => void | Promise<void>;
  /** 打回重生成，附意见。 */
  onReject: (feedback: string) => void | Promise<void>;
  busy?: boolean;
  /** 节点标题（如 nodeKey）。 */
  title?: string;
}

const VERDICT_STYLE: Record<string, { label: string; className: string }> = {
  pass: { label: "AI 自检：通过", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  pass_with_notes: {
    label: "AI 自检：有条件通过",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  },
  fail: { label: "AI 自检：未通过", className: "border-red-500/40 bg-red-500/10 text-red-400" },
};

export function severityBadgeClass(severity?: string): string {
  switch ((severity ?? "").toLowerCase()) {
    case "critical":
    case "blocker":
      return "border-red-500/40 bg-red-500/10 text-red-400";
    case "major":
      return "border-amber-500/40 bg-amber-500/10 text-amber-400";
    case "minor":
      return "border-sky-500/40 bg-sky-500/10 text-sky-400";
    default:
      return "border-border bg-bg-elevated text-text-muted";
  }
}

export function VerdictBadge({ verdict }: { verdict?: string | null }) {
  const key = (verdict ?? "").toLowerCase();
  const style = VERDICT_STYLE[key] ?? {
    label: verdict ? `AI 自检：${verdict}` : "AI 尚未自检",
    className: "border-border bg-bg-elevated text-text-muted",
  };
  return (
    <Badge variant="outline" className={cn("text-xs", style.className)}>
      {style.label}
    </Badge>
  );
}

export function IssueList({ issues }: { issues: ArtifactIssue[] }) {
  if (issues.length === 0) {
    return <p className="text-xs text-text-muted">暂无 AI 提出的问题。</p>;
  }
  return (
    <ul className="space-y-2">
      {issues.map((issue, i) => (
        <li key={i} className="rounded-md border border-border bg-bg-elevated/60 p-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("text-[10px]", severityBadgeClass(issue.severity))}>
              {issue.severity ?? "info"}
            </Badge>
            {issue.type && <span className="text-[10px] text-text-muted">{issue.type}</span>}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-xs text-text-secondary">
            {issue.description ?? JSON.stringify(issue)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** 单条 JSON 编辑器：受控文本 + 失焦/提交时校验。 */
function JsonEditor({
  value,
  onValidChange,
  disabled,
  minRows = 8,
}: {
  value: string;
  onValidChange: (text: string, parsed: unknown, valid: boolean) => void;
  disabled?: boolean;
  minRows?: number;
}) {
  const [invalid, setInvalid] = useState(false);
  return (
    <div>
      <Textarea
        value={value}
        disabled={disabled}
        rows={minRows}
        spellCheck={false}
        className={cn(
          "font-mono text-xs leading-5",
          invalid && "border-red-500/60 focus-visible:ring-red-500/40",
        )}
        onChange={(e) => {
          const text = e.target.value;
          try {
            onValidChange(text, JSON.parse(text), true);
            setInvalid(false);
          } catch {
            onValidChange(text, undefined, false);
            setInvalid(true);
          }
        }}
      />
      {invalid && <p className="mt-1 text-[11px] text-red-400">JSON 格式不合法，提交前请修正。</p>}
    </div>
  );
}

export default function ArtifactApprovalPanel({
  verdict,
  issues = [],
  content,
  userContent,
  onApprove,
  onReject,
  busy = false,
  title,
}: ArtifactApprovalPanelProps) {
  const isArray = Array.isArray(content);
  const items: unknown[] = isArray ? (content as unknown[]) : [content];

  // 每条编辑文本：初始取 userContent（差异对照优先）否则 content。
  const initialTexts = useMemo(() => {
    const userItems = Array.isArray(userContent) ? (userContent as unknown[]) : null;
    return items.map((item, i) => prettyJson(userItems?.[i] ?? (!isArray && userContent != null ? userContent : item)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, userContent]);

  const [texts, setTexts] = useState<string[]>(initialTexts);
  const [validFlags, setValidFlags] = useState<boolean[]>(() => items.map(() => true));
  const [confirmed, setConfirmed] = useState<boolean[]>(() => items.map(() => false));
  const [feedback, setFeedback] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);

  const allValid = validFlags.every(Boolean);
  const dirty = texts.some((t, i) => t !== prettyJson(items[i]));

  const updateText = (index: number, text: string, _parsed: unknown, valid: boolean) => {
    setTexts((prev) => prev.map((t, i) => (i === index ? text : t)));
    setValidFlags((prev) => prev.map((v, i) => (i === index ? valid : v)));
    if (!valid) {
      setConfirmed((prev) => prev.map((c, i) => (i === index ? false : c)));
    }
  };

  const parseAll = (): unknown[] | null => {
    const parsed: unknown[] = [];
    for (const t of texts) {
      try {
        parsed.push(JSON.parse(t));
      } catch {
        return null;
      }
    }
    return parsed;
  };

  const handleApprove = () => {
    if (!allValid) return;
    if (!dirty) {
      onApprove(undefined); // 采纳 AI 版本
      return;
    }
    const parsed = parseAll();
    if (!parsed) return;
    onApprove(isArray ? parsed : parsed[0]);
  };

  const handleConfirmAll = () => {
    if (!allValid) return;
    setConfirmed(items.map(() => true));
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* 左列：AI 结论 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <VerdictBadge verdict={verdict} />
          {title && <span className="truncate text-xs text-text-muted">{title}</span>}
        </div>
        <div className="max-h-80 overflow-y-auto pr-1">
          <IssueList issues={issues} />
        </div>
      </div>

      {/* 右列：可编辑产物 */}
      <div className="space-y-3">
        <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
          {items.map((item, i) => (
            <div key={i} className="rounded-md border border-border p-2">
              {isArray && (
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-text-muted">第 {i + 1} 条 / 共 {items.length} 条</span>
                  <div className="flex items-center gap-2">
                    {confirmed[i] && (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-400"
                      >
                        已确认
                      </Badge>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px]"
                      disabled={busy || !validFlags[i]}
                      onClick={() =>
                        setConfirmed((prev) => prev.map((c, idx) => (idx === i ? !c : c)))
                      }
                    >
                      {confirmed[i] ? "取消确认" : "确认本条"}
                    </Button>
                  </div>
                </div>
              )}
              <JsonEditor
                value={texts[i] ?? ""}
                disabled={busy}
                onValidChange={(text, parsed, valid) => updateText(i, text, parsed, valid)}
              />
            </div>
          ))}
        </div>

        {isArray && items.length > 1 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !allValid}
            onClick={handleConfirmAll}
          >
            全部通过
          </Button>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onApprove(undefined)}
          >
            采纳 AI 版本
          </Button>
          <Button type="button" size="sm" disabled={busy || !allValid} onClick={handleApprove}>
            {dirty ? "保存修改并提交" : "确认提交"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => setRejectOpen((v) => !v)}
          >
            打回重生成
          </Button>
        </div>

        {rejectOpen && (
          <div className="space-y-2 rounded-md border border-red-500/30 bg-red-500/5 p-2">
            <Textarea
              value={feedback}
              rows={3}
              placeholder="打回意见（会追加进 issues，供 AI 重生成参考）"
              className="text-xs"
              disabled={busy}
              onChange={(e) => setFeedback(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy || feedback.trim().length === 0}
              onClick={() => onReject(feedback.trim())}
            >
              确认打回（附意见）
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
