import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Settings, Crown, UserCog, User } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";

const ROLE_KEYS: Record<string, string> = {
  owner: "team_manage_role_owner",
  admin: "team_manage_role_admin",
  member: "team_manage_role_member",
};

type TeamInfoBarProps = {
  teamName: string;
  myRole: string;
  onEditClick?: () => void;
};

export default function TeamInfoBar({ teamName, myRole, onEditClick }: TeamInfoBarProps) {
  const { t } = useLanguage();
  const roleKey = ROLE_KEYS[myRole] ?? ROLE_KEYS.member;
  const roleIcons: Record<string, typeof Crown> = {
    owner: Crown,
    admin: UserCog,
    member: User,
  };
  const RoleIcon = roleIcons[myRole] ?? roleIcons.member;

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">{teamName}</h1>
        <Badge variant="outline" className="flex items-center gap-1.5">
          <RoleIcon className="w-3.5 h-3.5" />
          {t[roleKey as keyof typeof t]}
        </Badge>
      </div>
      {onEditClick && (
        <Button variant="outline" size="sm" onClick={onEditClick}>
          <Settings className="w-4 h-4 mr-2" />
          {t.team_manage_edit}
        </Button>
      )}
    </div>
  );
}
