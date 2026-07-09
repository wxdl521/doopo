import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Plus,
  Trash2,
  UserPlus,
  UserMinus,
  FolderPlus,
  FolderMinus,
  Crown,
  Pencil,
  Loader2,
  Users,
  FolderOpen,
} from "lucide-react";
import { toast } from "sonner";
import {
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  getGroupDetail,
  assignMemberToGroup,
  removeMemberFromGroup,
  assignProjectToGroup,
  unassignProjectFromGroup,
} from "@/lib/teamGroups.functions";
import { getTeamMembers } from "@/lib/teamMembers.functions";
import { listMyProjects } from "@/lib/projects.functions";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { useLanguage } from "@/i18n/LanguageContext";
import type { TeamGroupRow, GroupMemberRow, GroupProjectRow } from "@/lib/teamGroups.functions";
import type { MemberRow } from "@/lib/teamMembers.functions";
import type { ProjectListItem } from "@/lib/projects.functions";

type Props = {
  teamId: string;
  myRole: string;
};

export default function GroupsTab({ teamId, myRole }: Props) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const callListGroups = useServerFn(listGroups);
  const callCreate = useServerFn(createGroup);
  const callUpdate = useServerFn(updateGroup);
  const callDelete = useServerFn(deleteGroup);
  const callGetDetail = useServerFn(getGroupDetail);
  const callAssignMember = useServerFn(assignMemberToGroup);
  const callRemoveMember = useServerFn(removeMemberFromGroup);
  const callAssignProject = useServerFn(assignProjectToGroup);
  const callUnassignProject = useServerFn(unassignProjectFromGroup);
  const callGetMembers = useServerFn(getTeamMembers);
  const callListProjects = useServerFn(listMyProjects);

  const [groups, setGroups] = useState<TeamGroupRow[]>([]);
  const [teamMembers, setTeamMembers] = useState<MemberRow[]>([]);
  const [myProjects, setMyProjects] = useState<ProjectListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createAdminId, setCreateAdminId] = useState<string>("none");
  const [submitting, setSubmitting] = useState(false);

  // edit dialog
  const [editTarget, setEditTarget] = useState<TeamGroupRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editAdminId, setEditAdminId] = useState<string>("none");

  // delete confirm
  const [deleteTarget, setDeleteTarget] = useState<TeamGroupRow | null>(null);

  // detail dialog
  const [detailGroup, setDetailGroup] = useState<TeamGroupRow | null>(null);
  const [detailMembers, setDetailMembers] = useState<GroupMemberRow[]>([]);
  const [detailProjects, setDetailProjects] = useState<GroupProjectRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [addMemberId, setAddMemberId] = useState<string>("none");
  const [addProjectId, setAddProjectId] = useState<string>("none");
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const isOwner = myRole === "owner";

  const loadGroups = () =>
    callListGroups({ data: { teamId } })
      .then((r: any) => {
        if (r?.groups) setGroups(r.groups);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    loadGroups();
  }, [teamId]);

  // 拉全团队成员(供"加入组"/"指派组长"下拉)和我的项目(供"加入组"下拉)
  useEffect(() => {
    if (!isOwner && !groups.some((g) => g.isMyAdminGroup)) return;
    callGetMembers({ data: { teamId } })
      .then((r: any) => {
        if (r?.members) setTeamMembers(r.members);
      })
      .catch(() => {});
    callListProjects({ data: {} })
      .then((r: any) => {
        if (r?.projects) setMyProjects(r.projects);
      })
      .catch(() => {});
  }, [teamId, isOwner, groups]);

  const loadDetail = (group: TeamGroupRow) => {
    setDetailGroup(group);
    setDetailLoading(true);
    setAddMemberId("none");
    setAddProjectId("none");
    callGetDetail({ data: { groupId: group.id } })
      .then((r: any) => {
        setDetailMembers(r?.members ?? []);
        setDetailProjects(r?.projects ?? []);
      })
      .catch(() => {
        setDetailMembers([]);
        setDetailProjects([]);
      })
      .finally(() => setDetailLoading(false));
  };

  // ---- create ----
  const handleCreate = async () => {
    if (!createName.trim()) return;
    setSubmitting(true);
    try {
      const r: any = await callCreate({
        data: {
          teamId,
          name: createName.trim(),
          adminId: createAdminId === "none" ? undefined : createAdminId,
        },
      });
      if (r?.ok) {
        toast.success(t.team_groups_create_ok);
        setCreateOpen(false);
        setCreateName("");
        setCreateAdminId("none");
        await loadGroups();
      } else {
        toast.error(r?.error || t.team_groups_create_fail);
      }
    } catch {
      toast.error(t.team_groups_create_fail);
    } finally {
      setSubmitting(false);
    }
  };

  // ---- edit ----
  const openEdit = (g: TeamGroupRow) => {
    setEditTarget(g);
    setEditName(g.name);
    setEditAdminId(g.adminId ?? "none");
  };
  const handleEdit = async () => {
    if (!editTarget) return;
    setSubmitting(true);
    try {
      const r: any = await callUpdate({
        data: {
          groupId: editTarget.id,
          name: editName.trim() || undefined,
          adminId: editAdminId === "none" ? null : editAdminId,
        },
      });
      if (r?.ok) {
        toast.success(t.team_groups_update_ok);
        setEditTarget(null);
        await loadGroups();
      } else {
        toast.error(r?.error || t.team_groups_update_fail);
      }
    } catch {
      toast.error(t.team_groups_update_fail);
    } finally {
      setSubmitting(false);
    }
  };

  // ---- delete ----
  const handleDelete = async () => {
    if (!deleteTarget) return;
    const r: any = await callDelete({ data: { groupId: deleteTarget.id } });
    if (r?.ok) {
      toast.success(t.team_groups_delete_ok);
      setGroups((prev) => prev.filter((g) => g.id !== deleteTarget.id));
    } else {
      toast.error(r?.error || t.team_groups_delete_fail);
    }
    setDeleteTarget(null);
  };

  // ---- member ops ----
  const handleAddMember = async () => {
    if (!detailGroup || addMemberId === "none") return;
    const r: any = await callAssignMember({
      data: { teamId, groupId: detailGroup.id, userId: addMemberId },
    });
    if (r?.ok) {
      toast.success(t.team_groups_member_added);
      setAddMemberId("none");
      loadDetail(detailGroup);
      await loadGroups();
    } else {
      toast.error(r?.error || t.team_groups_member_add_fail);
    }
  };
  const handleRemoveMember = async (userId: string) => {
    if (!detailGroup) return;
    const r: any = await callRemoveMember({ data: { teamId, userId } });
    if (r?.ok) {
      toast.success(t.team_groups_member_removed);
      loadDetail(detailGroup);
      await loadGroups();
    } else {
      toast.error(r?.error || t.team_groups_member_remove_fail);
    }
  };

  // ---- project ops ----
  const handleAddProject = async () => {
    if (!detailGroup || addProjectId === "none") return;
    const r: any = await callAssignProject({
      data: { projectId: addProjectId, groupId: detailGroup.id },
    });
    if (r?.ok) {
      toast.success(t.team_groups_project_added);
      setAddProjectId("none");
      loadDetail(detailGroup);
      await loadGroups();
    } else {
      toast.error(r?.error || t.team_groups_project_add_fail);
    }
  };
  const handleUnassignProject = async (projectId: string) => {
    const r: any = await callUnassignProject({ data: { projectId } });
    if (r?.ok) {
      toast.success(t.team_groups_project_removed);
      if (detailGroup) loadDetail(detailGroup);
      await loadGroups();
    } else {
      toast.error(r?.error || t.team_groups_project_remove_fail);
    }
  };

  const canManageGroup = (g: TeamGroupRow) => isOwner || g.isMyAdminGroup;

  // 详情中可选加入组的成员(未在本组的团队成员)
  const availableMembers = teamMembers.filter(
    (m) => !detailMembers.some((dm) => dm.userId === m.userId),
  );
  // 详情中可选加入组的项目(未在本组的我的项目)
  const availableProjects = myProjects.filter((p) => !detailProjects.some((dp) => dp.id === p.id));

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
          {t.team_groups_count.replace("{count}", groups.length.toString())}
        </p>
        {isOwner && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            {t.team_groups_create}
          </Button>
        )}
      </div>

      {/* 组卡片 */}
      {groups.length === 0 ? (
        <section className="panel flex flex-col items-center gap-3 py-12">
          <Users className="w-10 h-10 text-text-muted" />
          <p className="text-sm text-text-muted">{t.team_groups_empty}</p>
          {isOwner && (
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              {t.team_groups_create}
            </Button>
          )}
        </section>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {groups.map((g) => (
            <section key={g.id} className="panel p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold truncate">{g.name}</h3>
                    {g.isMyGroup && (
                      <Badge variant="secondary" className="text-xs">
                        {t.team_groups_my_group}
                      </Badge>
                    )}
                    {g.isMyAdminGroup && (
                      <Badge className="text-xs gap-1">
                        <Crown className="w-3 h-3" />
                        {t.team_groups_my_admin}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t.team_groups_admin}:{" "}
                    {g.adminDisplayName ?? g.adminEmail ?? t.team_groups_no_admin}
                  </p>
                </div>
                {isOwner && (
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title={t.team_groups_edit}
                      onClick={() => openEdit(g)}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      title={t.team_groups_delete}
                      onClick={() => setDeleteTarget(g)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Users className="w-4 h-4" />
                  {t.team_groups_member_count.replace("{count}", g.memberCount.toString())}
                </span>
                <span className="inline-flex items-center gap-1">
                  <FolderOpen className="w-4 h-4" />
                  {t.team_groups_project_count.replace("{count}", g.projectCount.toString())}
                </span>
              </div>

              <Button variant="outline" size="sm" className="w-full" onClick={() => loadDetail(g)}>
                {t.team_groups_manage}
              </Button>
            </section>
          ))}
        </div>
      )}

      {/* ===== 创建组 ===== */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.team_groups_create}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t.team_groups_name}</Label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={t.team_groups_name_placeholder}
                maxLength={50}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t.team_groups_admin}</Label>
              <Select value={createAdminId} onValueChange={setCreateAdminId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t.team_groups_no_admin}</SelectItem>
                  {teamMembers
                    .filter((m) => m.role !== "owner")
                    .map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {m.displayName ?? m.email ?? m.userId}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-text-muted">{t.team_groups_admin_hint}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t.common_cancel}
            </Button>
            <Button onClick={handleCreate} disabled={submitting || !createName.trim()}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t.common_confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== 编辑组 ===== */}
      <Dialog open={!!editTarget} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.team_groups_edit}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t.team_groups_name}</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={50}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t.team_groups_admin}</Label>
              <Select value={editAdminId} onValueChange={setEditAdminId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t.team_groups_no_admin}</SelectItem>
                  {teamMembers
                    .filter((m) => m.role !== "owner")
                    .map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {m.displayName ?? m.email ?? m.userId}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              {t.common_cancel}
            </Button>
            <Button onClick={handleEdit} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t.common_confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== 组详情 ===== */}
      <Dialog open={!!detailGroup} onOpenChange={(open) => !open && setDetailGroup(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {detailGroup && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {detailGroup.name}
                  {detailGroup.isMyAdminGroup && (
                    <Badge className="gap-1">
                      <Crown className="w-3 h-3" />
                      {t.team_groups_my_admin}
                    </Badge>
                  )}
                </DialogTitle>
              </DialogHeader>

              {detailLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              ) : (
                <div className="space-y-6 py-2">
                  {/* 成员区 */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      {t.team_groups_members}({detailMembers.length})
                    </h4>
                    {canManageGroup(detailGroup) && (
                      <div className="flex gap-2">
                        <Select value={addMemberId} onValueChange={setAddMemberId}>
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder={t.team_groups_select_member} />
                          </SelectTrigger>
                          <SelectContent>
                            {availableMembers.length === 0 ? (
                              <SelectItem value="none" disabled>
                                {t.team_groups_no_candidates}
                              </SelectItem>
                            ) : (
                              availableMembers.map((m) => (
                                <SelectItem key={m.userId} value={m.userId}>
                                  {m.displayName ?? m.email ?? m.userId}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          onClick={handleAddMember}
                          disabled={addMemberId === "none"}
                        >
                          <UserPlus className="w-4 h-4 mr-1" />
                          {t.team_groups_add}
                        </Button>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {detailMembers.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-2">
                          {t.team_groups_no_members}
                        </p>
                      ) : (
                        detailMembers.map((m) => (
                          <div
                            key={m.userId}
                            className="flex items-center justify-between gap-2 bg-bg-elevated rounded-md px-3 py-2"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Avatar className="h-7 w-7">
                                <AvatarFallback className="text-xs">
                                  {(m.displayName ?? m.email ?? "?")[0].toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">
                                  {m.displayName ?? m.email ?? m.userId}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {m.email ?? "-"}
                                </div>
                              </div>
                            </div>
                            {canManageGroup(detailGroup) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                title={t.team_groups_remove_member}
                                onClick={() => handleRemoveMember(m.userId)}
                              >
                                <UserMinus className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* 项目区 */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <FolderOpen className="w-4 h-4" />
                        {t.team_groups_projects}({detailProjects.length})
                      </h4>
                      {canManageGroup(detailGroup) && (
                        <Button size="sm" variant="outline" onClick={() => setNewProjectOpen(true)}>
                          <Plus className="w-4 h-4 mr-1" />
                          {t.team_groups_new_project}
                        </Button>
                      )}
                    </div>
                    {canManageGroup(detailGroup) && (
                      <div className="flex gap-2">
                        <Select value={addProjectId} onValueChange={setAddProjectId}>
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder={t.team_groups_select_project} />
                          </SelectTrigger>
                          <SelectContent>
                            {availableProjects.length === 0 ? (
                              <SelectItem value="none" disabled>
                                {t.team_groups_no_candidates}
                              </SelectItem>
                            ) : (
                              availableProjects.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleAddProject}
                          disabled={addProjectId === "none"}
                        >
                          <FolderPlus className="w-4 h-4 mr-1" />
                          {t.team_groups_add}
                        </Button>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {detailProjects.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-2">
                          {t.team_groups_no_projects}
                        </p>
                      ) : (
                        detailProjects.map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center justify-between gap-2 bg-bg-elevated rounded-md px-3 py-2"
                          >
                            <button
                              className="text-sm font-medium truncate hover:text-accent text-left flex-1"
                              onClick={() => {
                                setDetailGroup(null);
                                navigate({
                                  to: "/workspace/$workspaceId",
                                  params: { workspaceId: p.id },
                                });
                              }}
                            >
                              {p.name}
                            </button>
                            {canManageGroup(detailGroup) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive shrink-0"
                                title={t.team_groups_remove_project}
                                onClick={() => handleUnassignProject(p.id)}
                              >
                                <FolderMinus className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.team_groups_delete_confirm_title}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.team_groups_delete_confirm_desc.replace("{name}", deleteTarget?.name ?? "")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common_cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.team_groups_delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 新建组项目(复用 NewProjectDialog,带 groupContext) */}
      {detailGroup && (
        <NewProjectDialog
          open={newProjectOpen}
          onOpenChange={setNewProjectOpen}
          groupContext={{
            teamId,
            groupId: detailGroup.id,
            groupName: detailGroup.name,
          }}
          onSaved={(saved) => {
            setNewProjectOpen(false);
            // 新建后把项目指派到本组(upsert 已带 group,这里刷新详情即可)
            void saved;
            loadDetail(detailGroup);
            loadGroups();
            navigate({ to: "/workspace/$workspaceId", params: { workspaceId: saved.id } });
          }}
        />
      )}
    </div>
  );
}
