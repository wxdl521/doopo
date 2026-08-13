import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adminResetUserPassword,
  adminSendPasswordResetEmail,
  adminSetUserBanned,
} from "@/lib/adminUsers.functions";
import { useLanguage } from "@/i18n/LanguageContext";

export type AdminUserAction = "reset" | "disable" | "enable";

export type AdminUserTarget = {
  userId: string;
  name: string;
  email: string | null;
};

type Props = {
  open: boolean;
  action: AdminUserAction;
  target: AdminUserTarget | null;
  onClose: () => void;
  onSuccess: () => void;
};

export default function AdminUserActionsDialog({
  open,
  action,
  target,
  onClose,
  onSuccess,
}: Props) {
  const { t } = useLanguage();
  const callReset = useServerFn(adminResetUserPassword);
  const callSendEmail = useServerFn(adminSendPasswordResetEmail);
  const callSetBanned = useServerFn(adminSetUserBanned);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPassword("");
      setConfirm("");
      setBusy(false);
    }
  }, [open, target?.userId, action]);

  if (!target) return null;

  const name = target.name || target.email || "";

  const submitReset = async () => {
    if (password.length < 8) {
      toast.error(t.admin_user_password_rule);
      return;
    }
    if (password !== confirm) {
      toast.error(t.admin_user_password_mismatch);
      return;
    }
    setBusy(true);
    const result: any = await callReset({ data: { userId: target.userId, newPassword: password } });
    setBusy(false);
    if (!result?.ok) {
      toast.error(result?.error || t.admin_user_reset_title);
      return;
    }
    toast.success(t.admin_user_reset_success);
    onSuccess();
    onClose();
  };

  const submitEmail = async () => {
    if (!target.email) {
      toast.error(t.admin_user_no_email);
      return;
    }
    setBusy(true);
    const result: any = await callSendEmail({ data: { email: target.email } });
    setBusy(false);
    if (!result?.ok) {
      toast.error(result?.error || t.admin_user_send_email);
      return;
    }
    toast.success(t.admin_user_send_email_success);
    onClose();
  };

  const submitBan = async (banned: boolean) => {
    setBusy(true);
    const result: any = await callSetBanned({ data: { userId: target.userId, banned } });
    setBusy(false);
    if (!result?.ok) {
      toast.error(result?.error || t.admin_user_disable_title);
      return;
    }
    toast.success(banned ? t.admin_user_disable_success : t.admin_user_enable_success);
    onSuccess();
    onClose();
  };

  const title =
    action === "reset"
      ? t.admin_user_reset_title
      : action === "disable"
        ? t.admin_user_disable_title
        : t.admin_user_enable_title;

  const desc = (
    action === "reset"
      ? t.admin_user_reset_desc
      : action === "disable"
        ? t.admin_user_disable_desc
        : t.admin_user_enable_desc
  ).replace("{name}", name);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>

        {action === "reset" && (
          <div className="space-y-4">
            <div>
              <label htmlFor="admin-new-password" className="mb-1.5 block text-sm font-medium">
                {t.admin_user_new_password}
              </label>
              <Input
                id="admin-new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t.admin_user_password_rule}
              />
            </div>
            <div>
              <label htmlFor="admin-confirm-password" className="mb-1.5 block text-sm font-medium">
                {t.admin_user_confirm_password}
              </label>
              <Input
                id="admin-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={() => void submitEmail()}
              disabled={busy}
              className="text-sm text-accent underline-offset-4 hover:underline disabled:opacity-50"
            >
              {t.admin_user_send_email}
            </button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t.common_cancel}
          </Button>
          {action === "reset" ? (
            <Button onClick={() => void submitReset()} disabled={busy}>
              {busy ? t.admin_user_saving : t.admin_user_reset_password}
            </Button>
          ) : action === "disable" ? (
            <Button
              onClick={() => void submitBan(true)}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? t.admin_user_saving : t.admin_user_disable}
            </Button>
          ) : (
            <Button onClick={() => void submitBan(false)} disabled={busy}>
              {busy ? t.admin_user_saving : t.admin_user_enable}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
