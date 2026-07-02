import { useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Trash2,
  UserPlus,
  Crown,
  UserCog,
  User,
  Copy,
  Check,
} from 'lucide-react'
import { getTeamMembers, updateMemberRole, removeMember } from '@/lib/teamMembers.functions'
import type { MemberRow } from '@/lib/teamMembers.functions'

const ROLE_OPTIONS = [
  { value: 'admin', label: '管理员', icon: UserCog },
  { value: 'member', label: '成员', icon: User },
]

const ROLE_BADGES: Record<string, { label: string; icon: typeof Crown; variant: 'default' | 'secondary' | 'outline' }> = {
  owner: { label: '所有者', icon: Crown, variant: 'default' },
  admin: { label: '管理员', icon: UserCog, variant: 'secondary' },
  member: { label: '成员', icon: User, variant: 'outline' },
}

type MembersTabProps = {
  teamId: string
  myRole: string
  onManageCredits: (member: MemberRow, mode: 'allocate' | 'reclaim') => void
}

export default function MembersTab({ teamId, myRole, onManageCredits }: MembersTabProps) {
  const callGetMembers = useServerFn(getTeamMembers)
  const callUpdateRole = useServerFn(updateMemberRole)
  const callRemoveMember = useServerFn(removeMember)

  const [members, setMembers] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<MemberRow | null>(null)
  const [inviteCopied, setInviteCopied] = useState(false)

  const loadMembers = () => {
    callGetMembers({ data: { teamId } })
      .then((r: any) => {
        if (r?.members) setMembers(r.members)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadMembers() }, [teamId])

  const handleRoleChange = async (userId: string, newRole: string) => {
    const r: any = await callUpdateRole({ data: { teamId, userId, role: newRole as 'admin' | 'member' } })
    if (r?.ok) loadMembers()
  }

  const handleRemove = async () => {
    if (!deleteTarget) return
    const r: any = await callRemoveMember({ data: { teamId, userId: deleteTarget.userId } })
    if (r?.ok) {
      setMembers((prev) => prev.filter((m) => m.userId !== deleteTarget.userId))
    }
    setDeleteTarget(null)
  }

  const handleInvite = () => {
    const url = `${window.location.origin}/team/${teamId}/join`
    navigator.clipboard.writeText(url).then(() => {
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 2000)
    }).catch(() => {})
  }

  const canChangeRole = (target: MemberRow) => {
    if (myRole === 'owner') return target.role !== 'owner'
    if (myRole === 'admin') return target.role === 'member'
    return false
  }

  const canManageCredits = (target: MemberRow) => {
    if (myRole === 'owner') return target.role !== 'owner'
    if (myRole === 'admin') return target.role === 'member'
    return false
  }

  const canDelete = (target: MemberRow) => {
    if (target.role === 'owner') return false
    if (myRole === 'owner') return true
    if (myRole === 'admin') return target.role === 'member'
    return false
  }

  const showActions = (target: MemberRow) => {
    return canManageCredits(target) || canDelete(target)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          共 {members.length} 位成员
        </p>
        {(myRole === 'owner' || myRole === 'admin') && (
          <Button variant="outline" size="sm" onClick={handleInvite}>
            {inviteCopied ? (
              <Check className="w-4 h-4 mr-2" />
            ) : (
              <UserPlus className="w-4 h-4 mr-2" />
            )}
            {inviteCopied ? '已复制链接' : '邀请成员'}
          </Button>
        )}
      </div>

      {/* 成员表格 */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>成员</TableHead>
              <TableHead>邮箱</TableHead>
              <TableHead>角色</TableHead>
              <TableHead className="text-right">可用积分</TableHead>
              <TableHead>加入时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  暂无成员
                </TableCell>
              </TableRow>
            ) : (
              members.map((member) => {
                const roleInfo = ROLE_BADGES[member.role] ?? ROLE_BADGES.member
                const RoleIcon = roleInfo.icon

                return (
                  <TableRow key={member.id}>
                    {/* 头像 + 昵称 */}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs">
                            {(member.displayName ?? member.email ?? '?')[0].toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-sm">
                          {member.displayName ?? '未知用户'}
                        </span>
                      </div>
                    </TableCell>

                    {/* 邮箱 */}
                    <TableCell className="text-muted-foreground text-sm">
                      {member.email ?? '-'}
                    </TableCell>

                    {/* 角色 */}
                    <TableCell>
                      {canChangeRole(member) ? (
                        <Select
                          value={member.role}
                          onValueChange={(v) => handleRoleChange(member.userId, v)}
                        >
                          <SelectTrigger className="h-8 w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                <span className="flex items-center gap-1.5">
                                  <opt.icon className="w-3.5 h-3.5" />
                                  {opt.label}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant={roleInfo.variant} className="flex items-center gap-1 w-fit">
                          <RoleIcon className="w-3 h-3" />
                          {roleInfo.label}
                        </Badge>
                      )}
                    </TableCell>

                    {/* 可用积分 */}
                    <TableCell className="text-right">
                      <span className="font-medium">{member.creditsBalance}</span>
                      <span className="text-xs text-muted-foreground ml-1">
                        (+{member.subscriptionCredits} 订阅)
                      </span>
                    </TableCell>

                    {/* 加入时间 */}
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(member.joinedAt).toLocaleDateString('zh-CN')}
                    </TableCell>

                    {/* 操作 */}
                    <TableCell className="text-right">
                      {showActions(member) && (
                        <div className="flex items-center justify-end gap-1">
                          {canManageCredits(member) && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="分配积分"
                                onClick={() => onManageCredits(member, 'allocate')}
                              >
                                <ArrowDownToLine className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                title="回收积分"
                                onClick={() => onManageCredits(member, 'reclaim')}
                              >
                                <ArrowUpFromLine className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                          {canDelete(member) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              title="移除成员"
                              onClick={() => setDeleteTarget(member)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* 删除确认弹窗 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认移除成员</AlertDialogTitle>
            <AlertDialogDescription>
              确定要将 {deleteTarget?.displayName ?? deleteTarget?.email ?? '该成员'} 移出团队吗？
              {deleteTarget && deleteTarget.creditsBalance > 0 && (
                <span className="block mt-2 text-destructive">
                  该成员还有 {deleteTarget.creditsBalance} 可用积分，将被退回团队池。
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              确认移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
