import { Link, useRouterState } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'

export type SectionNavItem = {
  to: string
  label: string
  icon: LucideIcon
}

export default function SectionSidebar({
  title,
  items,
}: {
  title: string
  items: SectionNavItem[]
}) {
  const path = useRouterState({ select: (s) => s.location.pathname })
  return (
    <aside className="md:w-56 md:shrink-0">
      <div className="panel p-3">
        <div className="px-3 py-2 text-xs font-semibold tracking-wide text-text-muted uppercase">
          {title}
        </div>
        <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
          {items.map((it) => {
            const active = path === it.to || (it.to !== '/' && path.startsWith(it.to + '/'))
            const Icon = it.icon
            return (
              <Link
                key={it.to}
                to={it.to}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition ${
                  active
                    ? 'bg-accent-dim text-accent font-semibold'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
                }`}
              >
                <Icon size={15} />
                <span>{it.label}</span>
              </Link>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}
