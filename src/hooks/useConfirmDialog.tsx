// ====================================================================
// useConfirmDialog：Promise 风格的确认弹窗，替代原生 window.confirm。
// 基于 shadcn AlertDialog；confirm({ title, description, confirmText,
// danger })  resolve 为用户选择（true=确认，false=取消/关闭），
// 返回的 <ConfirmDialog /> 需在调用组件的 JSX 里渲染一次。
// 删除类操作传 danger: true，确认按钮使用危险色，文案默认「删除」。
// ====================================================================

import { useCallback, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageContext";
import type { Translations } from "@/i18n/zh";

export type ConfirmDialogOptions = {
  title: string;
  description?: string;
  /** 确认按钮文案；缺省时 danger 为「删除」，否则为「确认」。 */
  confirmText?: string;
  /** 删除等破坏性操作：确认按钮使用危险色。 */
  danger?: boolean;
};

type PendingConfirm = {
  options: ConfirmDialogOptions;
  resolve: (confirmed: boolean) => void;
};

function ConfirmDialogView({
  pending,
  onSettle,
  t,
}: {
  pending: PendingConfirm;
  onSettle: (confirmed: boolean) => void;
  t: Translations;
}) {
  const { options } = pending;
  return (
    <AlertDialog open onOpenChange={(open) => !open && onSettle(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className={options.danger ? "text-destructive" : undefined}>
            {options.title}
          </AlertDialogTitle>
          {options.description ? (
            <AlertDialogDescription>{options.description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onSettle(false)}>
            {t.common_cancel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onSettle(true)}
            className={options.danger ? buttonVariants({ variant: "destructive" }) : undefined}
          >
            {options.confirmText ?? (options.danger ? t.common_delete : t.common_confirm)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function useConfirmDialog() {
  const { t } = useLanguage();
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // 连续调用时只保留最新一次；被覆盖的旧 Promise 立即按「取消」解决，
  // 避免调用方永远 await 不到结果。
  const pendingRef = useRef<PendingConfirm | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback((options: ConfirmDialogOptions) => {
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      setPending({ options, resolve });
    });
  }, []);

  const settle = useCallback((confirmed: boolean) => {
    setPending((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  // useCallback 保持组件身份稳定：父组件无关重渲染不会卸载弹窗子树。
  const ConfirmDialog = useCallback(
    function ConfirmDialog() {
      if (!pending) return null;
      return <ConfirmDialogView pending={pending} onSettle={settle} t={t} />;
    },
    [pending, settle, t],
  );

  return { confirm, ConfirmDialog };
}
