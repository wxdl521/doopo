import { useEffect, useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import {
  Crown,
  UserCog,
  User,
  ArrowDownToLine,
  ArrowUpFromLine,
  Trash2,
} from 'lucide-react'
import { getTeamMembers, updateMemberRole, removeMember } from '@/lib/teamMembers.functions'
import { useLanguage } from '@/i18n/LanguageContext'
import type { MemberRow } from '@/lib/teamMembers.functions'

type MembersTabProps = {
  teamId: string
  myRole: string
  onManageCredits: (member: MemberRow, mode: 'allocate' | 'reclaim') => void
}

const ROLE_ICON: Record<string, typeof Crown> = {
  owner: Crown,
  admin: UserCog,
  member: User,
}

export default function MembersTab({ teamId, myRole, onManageCredits }: MembersTabProps) {
  const { t } = useLanguage()
  const callMembers = useServerFn(getTeamMembers)
  const callUpdateRole = useServerFn(updateMemberRole)
  const callRemoveMember = useServerFn(removeMember)

  const [members, setMembers] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<MemberRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    callMembers({ data: { teamId } })
      .then((r: any) => {
        if (r?.members) setMembers(r.members)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [teamId, callMembers])

  const handleRoleChange = async (memberId: string, newRole: string) => {
    const r: any = await callUpdateRole({ data: { teamId, memberId, role: newRole } })
    if (r?.ok) {
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m)),
      )
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    const r: any = await callRemoveMember({ data: { teamId, memberId: deleteTarget.id } })
    setDeleting(false)
    if (r?.ok) {
      setMembers((prev) => prev.filter((m) => m.id !== deleteTarget.id))
    }
    setDeleteTarget(null)
  }

  const roleLabel: Record<string, string> = {
    owner: t.team_role_owner,
    admin: t.team_role_admin,
    member: t.team_role_member,
  }

  const canChangeRole = (targetRole: string) => {
    if (myRole === 'owner') return targetRole !== 'owner'
    if (myRole === 'admin') return targetRole === 'member'
    return false
  }

  const canManageCredits = (targetRole: string) => {
    if (myRole === 'owner') return true
    if (myRole === 'admin') return targetRole === 'member'
    return false
  }

  const canDelete = (targetRole: string) => {
    if (myRole === 'owner') return targetRole !== 'owner'
    if (myRole === 'admin') return targetRole === 'member'
    return false
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div>
      <h3 className="font-display text-lg font-bold mb-4">{t.team_members_list}</h3>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.team_col_avatar_name}</TableHead>
              <TableHead>{t.common_email}</TableHead>
              <TableHead>{t.team_col_role}</TableHead>
              <TableHead>{t.team_col_joined}</TableHead>
              <TableHead className="text-right">{t.common_actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  {t.team_no_members}
                </TableCell>
              </TableRow>
            ) : (
              members.map((member) => {
                const Icon = ROLE_ICON[member.role] ?? User
                const showActions = canDelete(member.role) || canManageCredits(member.role)

                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="w-8 h-8">
                          <AvatarImage src={member.avatarUrl ?? undefined} />
                          <AvatarFallback>
                            <User className="w-4 h-4" />
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-sm">{member.nickname ?? member.email}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{member.email}</TableCell>
                    <TableCell>
                      {canChangeRole(member.role) ? (
                        <Select
                          value={member.role}
                          onValueChange={(value) => handleRoleChange(member.id, value)}
                        >
                          <SelectTrigger className="w-24 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {myRole === 'owner' && (
                              <SelectItem value="admin">{t.team_role_admin}</SelectItem>
                            )}
                            <SelectItem value="member">{t.team_role_member}</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline" className="flex items-center gap-1.5 w-fit">
                          <Icon className="w-3 h-3" />
                          <span className="text-xs">{roleLabel[member.role]}</span>
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(member.joinedAt).toLocaleDateString('zh-CN')}
                    </TableCell>
                    <TableCell className="text-right">
                      {showActions && (
                        <div className="flex items-center justify-end gap-1">
                          {canManageCredits(member.role) && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onManageCredits(member, 'allocate')}
                                title={t.team_allocate}
                              >
                                <ArrowDownToLine className="w-4 h-4 text-green-500" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onManageCredits(member, 'reclaim')}
                                title={t.team_reclaim}
                              >
                                <ArrowUpFromLine className="w-4 h-4 text-orange-500" />
                              </Button>
                            </>
                          )}
                          {canDelete(member.role) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteTarget(member)}
                              title={t.team_remove_member}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
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
            <AlertDialogTitle>{t.team_remove_confirm_title}</AlertDialogTitle>
            <AlertDialogDescription>{t.team_remove_confirm_desc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common_cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? '...' : t.common_confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
