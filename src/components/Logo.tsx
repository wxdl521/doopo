import { Link } from '@tanstack/react-router'

export default function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'lg' ? 40 : size === 'sm' ? 24 : 32
  const text = size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-lg' : 'text-2xl'
  return (
    <Link to="/home" className="flex items-center gap-2.5 group">
      <svg width={dim} height={dim} viewBox="0 0 64 64" className="transition-transform group-hover:scale-105 flex-shrink-0">
        <defs>
          <linearGradient id="doopooGrad" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#59C9D5" />
            <stop offset="50%" stopColor="#83CBA4" />
            <stop offset="100%" stopColor="#B5D684" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill="#f0f7f5" />
        <rect width="64" height="64" rx="16" fill="rgba(89,201,213,0.08)" />
        <path
          d="M16 22 L48 22 L20 44 L48 44"
          stroke="url(#doopooGrad)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <span className={`font-display font-bold tracking-tight gradient-text ${text}`}>
        doopoo
      </span>
    </Link>
  )
}