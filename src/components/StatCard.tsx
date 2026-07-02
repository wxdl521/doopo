import type { LucideIcon } from "lucide-react";

export default function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon?: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-500"
      : tone === "warning"
        ? "text-amber-500"
        : tone === "danger"
          ? "text-rose-500"
          : "text-accent";
  return (
    <div className="panel p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-muted">{label}</span>
        {Icon && (
          <span
            className={`w-9 h-9 rounded-lg bg-bg-elevated flex items-center justify-center ${toneClass}`}
          >
            <Icon size={16} />
          </span>
        )}
      </div>
      <div className="font-display text-2xl font-bold text-text-primary">{value}</div>
      {hint && <div className="text-xs text-text-muted">{hint}</div>}
    </div>
  );
}
