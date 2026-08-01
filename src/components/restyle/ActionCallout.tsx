// ====================================================================
// 待确认视觉：动作口令待办卡片（ActionCallout）+ 统一待确认容器
// （PendingCard）。AssetConfirmationGuide / ImageGenerationModeGuide
// 与口令气泡共用同一套强调样式：强调竖条 + bg-accent-dim +
// border-accent/40 + 加粗标题。
// ====================================================================

import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { Translations } from "../../i18n/zh";

/** 助手消息里的动作口令。出现即把气泡升级为待办卡片。 */
export const ACTION_PHRASES = ["继续下一步", "确认生成视频", "全部由 AI 生成"] as const;

const ACTION_PATTERNS: Array<RegExp> = [/继续下一步/, /确认生成视频/, /全部由\s*AI\s*生成/i];

/** 从消息文本里提取出现的动作口令，保持 ACTION_PHRASES 的顺序。 */
export function extractActionPhrases(content: string): string[] {
  return ACTION_PHRASES.filter((_, index) => ACTION_PATTERNS[index]!.test(content));
}

/**
 * 找出对话里最新一条「未响应」的待确认口令：从末尾往回扫，
 * 遇到用户消息即视为已响应；遇到含口令的助手消息即返回首个口令。
 */
export function findPendingActionPhrase(
  messages: Array<{ role?: "user" | "assistant"; content: string }>,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "user") return null;
    if (message.role !== "assistant") continue;
    const phrases = extractActionPhrases(message.content);
    if (phrases.length) return phrases[0]!;
  }
  return null;
}

/** 统一待确认容器：强调竖条 + bg-accent-dim + border-accent/40 + 加大加粗标题。 */
export function PendingCard({
  title,
  children,
  className = "",
  testId,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={`relative overflow-hidden rounded-xl border border-accent/40 bg-accent-dim py-3 pl-5 pr-3 ${className}`}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-accent" />
      <p className="flex items-center gap-1.5 text-sm font-bold text-text-primary">
        <Sparkles size={14} className="text-accent" />
        {title}
      </p>
      {children}
    </div>
  );
}

/**
 * 动作口令待办卡片：助手消息含「继续下一步 / 确认生成视频 / 全部由 AI 生成」
 * 时替代普通气泡。口令渲染为加粗强调色 chip，点击即发送该口令。
 */
export function ActionCallout({
  content,
  phrases,
  onRun,
  disabled,
  t,
}: {
  content: string;
  phrases: string[];
  onRun: (phrase: string) => void;
  disabled?: boolean;
  t: Translations;
}) {
  return (
    <PendingCard
      title={t.restyle_action_callout_title}
      testId="restyle-action-callout"
      className="mt-0 max-w-[85%]"
    >
      <p className="mt-1.5 text-sm leading-6 text-text-secondary">{content}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {phrases.map((phrase) => (
          <button
            key={phrase}
            type="button"
            disabled={disabled}
            onClick={() => onRun(phrase)}
            className="rounded-full border border-accent/50 bg-bg-surface px-3 py-1 text-xs font-bold text-accent shadow-sm transition hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phrase}
          </button>
        ))}
      </div>
    </PendingCard>
  );
}

export function ImageGenerationModeGuide({ t }: { t: Translations }) {
  return (
    <PendingCard title={t.restyle_image_generation_title} className="mt-4">
      <div className="mt-1.5 text-xs leading-5 text-text-secondary">
        <p>{t.restyle_image_generation_ai}</p>
        <p>{t.restyle_image_generation_reference}</p>
        <p className="text-text-muted">{t.restyle_image_generation_example}</p>
      </div>
    </PendingCard>
  );
}

export function AssetConfirmationGuide({ t }: { t: Translations }) {
  return (
    <PendingCard title={t.restyle_assets_confirmation_intro} className="mt-4">
      <ul className="mt-2 grid gap-1 pl-4 text-xs leading-5 text-text-secondary sm:grid-cols-2">
        <li>{t.restyle_assets_check_characters}</li>
        <li>{t.restyle_assets_check_scenes}</li>
        <li>{t.restyle_assets_check_props}</li>
        <li>{t.restyle_assets_check_market}</li>
      </ul>
      <p className="mt-2 text-xs leading-5 text-text-secondary">
        {t.restyle_assets_feedback_hint}{" "}
        <span className="text-text-muted">{t.restyle_assets_feedback_example}</span>
      </p>
    </PendingCard>
  );
}
