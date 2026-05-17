import { Link } from '@tanstack/react-router'

export default function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'lg' ? 40 : size === 'sm' ? 24 : 32
  const text = size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-lg' : 'text-2xl'
  const letter = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-lg'
  return (
    <Link to="/home" className="flex items-center gap-2.5 group">
      <div
        className={`grid place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-orange-400 text-white font-display font-bold shadow-card transition-transform group-hover:scale-105 flex-shrink-0 ${letter} px-1.5`}
        style={{ width: 'auto', minWidth: dim, height: dim }}
      >
        Do
      </div>
      <span className={`font-display font-bold tracking-tight gradient-text ${text}`}>
        doopoo
      </span>
    </Link>
  )
}
