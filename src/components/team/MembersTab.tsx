import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { UserPlus, Crown, UserCog, User, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getTeamMembers, removeMember, updateMemberRole } from "@/lib/teamMembers.functions";
import { useLanguage } from "@/i18n/LanguageContext";
import type { MemberRow } from "@/lib/teamMembers.functions";

const ROLE_OPTIONS = [
  { value: "admin", labelKey: "team_manage_role_admin" as const, icon: UserCog },
  { value: "member", labelKey: "team_manage_role_member" as const, icon: User },
] as const;

const ROLE_BADGES: Record<
  string,
  {
    labelKey: keyof ReturnType<typeof useLanguage>["t"];
    icon: typeof Crown;
    variant: "default" | "secondary" | "outline";
  }
> = {
  owner: { labelKey: "team_manage_role_owner", icon: Crown, variant: "default" },
  admin: { labelKey: "team_manage_role_admin", icon: UserCog, variant: "secondary" },
  member: { labelKey: "team_manage_role_member", icon: User, variant: "outline" },
};

type MembersTabProps = {
  teamId: string;
  myRole: string;
  onManageCredits: (member: MemberRow) => void;
};

export default function MembersTab({ teamId, myRole, onManageCredits }: MembersTabProps) {
  const { t } = useLanguage();
  const callGetMembers = useServerFn(getTeamMembers);
  const callUpdateRole = useServerFn(updateMemberRole);
  const callRemoveMember = useServerFn(removeMember);

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [changingUserId, setChangingUserId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);
  const [removing, setRemoving] = useState(false);

  const loadMembers = () => {
    return callGetMembers({ data: { teamId } })
      .then((r: any) => {
        if (r?.members) setMembers(r.members);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadMembers();
  }, [teamId]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    setChangingUserId(userId);
    try {
      const r: any = await callUpdateRole({
        data: { teamId, userId, role: newRole as "admin" | "member" },
      });
      if (r?.ok) {
        await loadMembers();
      } else {
        toast.error(r?.error || "角色变更失败");
        await loadMembers(); // 回退 Select 显示值
      }
    } catch {
      toast.error("角色变更失败，请重试");
      await loadMembers(); // 回退 Select 显示值
    } finally {
      setChangingUserId(null);
    }
  };

  const handleInvite = () => {
    const url = `${window.location.origin}/team/${teamId}/join`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setInviteCopied(true);
        setTimeout(() => setInviteCopied(false), 2000);
      })
      .catch(() => {});
  };

  const canChangeRole = (target: MemberRow) => {
    return myRole === "owner" && target.role !== "owner";
  };

  const canManageCredits = (target: MemberRow) => {
    if (myRole === "owner") return target.role !== "owner";
    if (myRole === "admin") return target.role === "member";
    return false;
  };

  const canRemoveMember = (target: MemberRow) => {
    return myRole === "owner" && target.role !== "owner";
  };

  const showActions = (target: MemberRow) => {
    return canManageCredits(target) || canRemoveMember(target);
  };

  const handleRemoveMember = async () => {
    if (!removeTarget) return;

    setRemoving(true);
    try {
      const r: any = await callRemoveMember({
        data: { teamId, userId: removeTarget.userId },
      });
      if (r?.ok) {
        toast.success(t.team_manage_remove_success);
        setRemoveTarget(null);
        await loadMembers();
      } else {
        toast.error(r?.error || t.team_manage_remove_fail);
      }
    } catch {
      toast.error(t.team_manage_remove_fail);
    } finally {
      setRemoving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t.team_manage_member_count.replace("{count}", members.length.toString())}
        </p>
        {(myRole === "owner" || myRole === "admin") && (
          <Button variant="outline" size="sm" onClick={handleInvite}>
            {inviteCopied ? (
              <Check className="w-4 h-4 mr-2" />
            ) : (
              <UserPlus className="w-4 h-4 mr-2" />
            )}
            {inviteCopied ? t.team_manage_invite_copied : t.team_manage_invite}
          </Button>
        )}
      </div>

      {/* 成员表格 */}
      <section className="panel p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.team_manage_col_member}</TableHead>
              <TableHead>{t.team_manage_col_email}</TableHead>
              <TableHead>{t.team_manage_col_role}</TableHead>
              <TableHead>{t.team_manage_col_group}</TableHead>
              <TableHead className="text-right">{t.team_manage_col_credits}</TableHead>
              <TableHead>{t.team_manage_col_joined}</TableHead>
              <TableHead className="text-right">{t.team_manage_col_actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {t.team_manage_no_members}
                </TableCell>
              </TableRow>
            ) : (
              members.map((member) => {
                const roleInfo = ROLE_BADGES[member.role] ?? ROLE_BADGES.member;
                const RoleIcon = roleInfo.icon;

                return (
                  <TableRow key={member.id}>
                    {/* 头像 + 昵称 */}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs">
                            {(member.displayName ?? member.email ?? "?")[0].toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-sm">
                          {member.displayName ?? t.team_manage_unknown_user}
                        </span>
                      </div>
                    </TableCell>

                    {/* 邮箱 */}
                    <TableCell className="text-muted-foreground text-sm">
                      {member.email ?? "-"}
                    </TableCell>

                    {/* 角色 */}
                    <TableCell>
                      {canChangeRole(member) ? (
                        <div className="flex items-center gap-1.5">
                          <Select
                            value={member.role}
                            onValueChange={(v) => handleRoleChange(member.userId, v)}
                            disabled={changingUserId === member.userId}
                          >
                            <SelectTrigger className="h-8 w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLE_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  <span className="flex items-center gap-1.5">
                                    <opt.icon className="w-3.5 h-3.5" />
                                    {t[opt.labelKey]}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {changingUserId === member.userId && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                          )}
                        </div>
                      ) : (
                        <Badge variant={roleInfo.variant} className="flex items-center gap-1 w-fit">
                          <RoleIcon className="w-3 h-3" />
                          {t[roleInfo.labelKey]}
                        </Badge>
                      )}
                    </TableCell>

                    {/* 分组 */}
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {member.groupName ?? t.team_manage_ungrouped}
                      </Badge>
                    </TableCell>

                    {/* 可用积分 */}
                    <TableCell className="text-right">
                      <span className="font-medium">{member.creditsBalance}</span>
                      <span className="text-xs text-muted-foreground ml-1">
                        (+{member.subscriptionCredits} {t.team_manage_subscription_credits})
                      </span>
                    </TableCell>

                    {/* 加入时间 */}
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(member.joinedAt).toLocaleDateString("zh-CN")}
                    </TableCell>

                    {/* 操作 */}
                    <TableCell className="text-right">
                      {showActions(member) && (
                        <div className="flex items-center justify-end gap-1">
                          {canManageCredits(member) && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => onManageCredits(member)}
                            >
                              {t.team_manage_allocate}
                            </Button>
                          )}
                          {canRemoveMember(member) && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-destructive hover:text-destructive"
                              onClick={() => setRemoveTarget(member)}
                            >
                              {t.team_manage_remove}
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </section>

      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              {t.team_manage_remove_confirm_title}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                {t.team_manage_remove_confirm_desc.replace(
                  "{name}",
                  removeTarget?.displayName ?? removeTarget?.email ?? t.team_manage_unknown_user,
                )}
              </span>
              {removeTarget && removeTarget.creditsBalance > 0 && (
                <span className="block text-destructive">
                  {t.team_manage_remove_credits_warning.replace(
                    "{credits}",
                    removeTarget.creditsBalance.toString(),
                  )}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>{t.common_cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={handleRemoveMember}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t.team_manage_remove_confirm_btn}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
