import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Settings, Crown, UserCog, User } from 'lucide-react'

const ROLE_CONFIG: Record<string, { label: string; icon: typeof Crown }> = {
  owner: { label: '所有者', icon: Crown },
  admin: { label: '管理员', icon: UserCog },
  member: { label: '成员', icon: User },
}

type TeamInfoBarProps = {
  teamName: string
  myRole: string
  onEditClick?: () => void
}

export default function TeamInfoBar({ teamName, myRole, onEditClick }: TeamInfoBarProps) {
  const roleInfo = ROLE_CONFIG[myRole] ?? ROLE_CONFIG.member
  const RoleIcon = roleInfo.icon

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{teamName}</h1>
        <Badge variant="outline" className="flex items-center gap-1.5">
          <RoleIcon className="w-3.5 h-3.5" />
          {roleInfo.label}
        </Badge>
      </div>
      {onEditClick && (
        <Button variant="outline" size="sm" onClick={onEditClick}>
          <Settings className="w-4 h-4 mr-2" />
          编辑
        </Button>
      )}
    </div>
  )
}
