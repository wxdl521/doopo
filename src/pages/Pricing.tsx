import { Check, Sparkles, Star, Zap } from 'lucide-react'
import { useState } from 'react'

type Plan = {
  id: string
  name: string
  tagline: string
  monthly: number
  yearly: number
  points: string
  features: string[]
  highlight?: boolean
  ribbon?: string
}

const plans: Plan[] = [
  {
    id: 'free',
    name: 'Starter',
    tagline: 'Try the agent on a small story.',
    monthly: 0,
    yearly: 0,
    points: '70 pts / month',
    features: [
      'All free models',
      '720p exports',
      '1 active project',
      'Community support',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For solo creators shipping weekly.',
    monthly: 29,
    yearly: 290,
    points: '2,400 pts / month',
    features: [
      'Premium models (Sora, Veo, Kling)',
      '1080p exports & per-shot stems',
      'Unlimited projects, 5 active Bases',
      'Priority queue',
      'Email support',
    ],
    highlight: true,
    ribbon: 'Most popular',
  },
  {
    id: 'studio',
    name: 'Studio',
    tagline: 'For teams and brand work.',
    monthly: 99,
    yearly: 990,
    points: '12,000 pts / month',
    features: [
      'All Pro features',
      '4K exports + ProRes',
      'Team Bases & shared seats (3)',
      'API access (10k req / mo)',
      'Dedicated support channel',
    ],
  },
]

export default function Pricing() {
  const [annual, setAnnual] = useState(true)

  return (
    <div className="animate-fade-in">
      <div className="text-center mb-10">
        <h1 className="font-display text-4xl md:text-5xl font-bold">
          Pricing that scales with your <span className="gradient-text">story</span>.
        </h1>
        <p className="text-text-secondary mt-3 max-w-2xl mx-auto">
          One subscription unlocks every model on Doopoo. Points roll over for two months;
          unused points convert to render credits the third.
        </p>

        <div className="mt-6 inline-flex items-center gap-1 p-1 rounded-full bg-bg-elevated border border-border">
          <button
            onClick={() => setAnnual(false)}
            className={`px-4 py-1.5 rounded-full text-sm transition ${!annual ? 'bg-accent text-bg font-semibold' : 'text-text-secondary'}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setAnnual(true)}
            className={`px-4 py-1.5 rounded-full text-sm transition ${annual ? 'bg-accent text-bg font-semibold' : 'text-text-secondary'}`}
          >
            Annual <span className="ml-1 text-[10px] uppercase tracking-wider">save 17%</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-6xl mx-auto">
        {plans.map((p) => {
          const price = annual ? Math.round(p.yearly / 12) : p.monthly
          return (
            <div
              key={p.id}
              className={`relative panel p-7 flex flex-col ${
                p.highlight ? 'border-accent/60 shadow-glow-lg bg-gradient-to-b from-accent-dim/10 to-transparent' : ''
              }`}
            >
              {p.ribbon && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full
                                 bg-accent text-bg text-xs font-bold uppercase tracking-wider shadow-glow flex items-center gap-1">
                  <Star size={12} fill="currentColor" /> {p.ribbon}
                </span>
              )}

              <div>
                <h3 className="font-display text-2xl font-bold">{p.name}</h3>
                <p className="text-text-secondary text-sm mt-1">{p.tagline}</p>
              </div>

              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-display font-bold">${price}</span>
                <span className="text-text-muted">/mo</span>
                {annual && p.monthly > 0 && (
                  <span className="ml-2 text-xs text-text-muted line-through">${p.monthly}</span>
                )}
              </div>
              <div className="mt-1 text-sm text-accent flex items-center gap-1.5">
                <Zap size={13} /> {p.points}
              </div>

              <button
                className={`mt-6 w-full justify-center ${p.highlight ? 'btn-primary' : 'btn-outline'}`}
              >
                <Sparkles size={14} /> {p.id === 'free' ? 'Start free' : `Choose ${p.name}`}
              </button>

              <ul className="mt-7 space-y-3">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-sm">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-accent-dim text-accent flex items-center justify-center shrink-0">
                      <Check size={12} strokeWidth={3} />
                    </span>
                    <span className="text-text-secondary">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      <section className="mt-20 max-w-4xl mx-auto">
        <h2 className="font-display text-2xl font-bold mb-5">Frequently asked</h2>
        <div className="space-y-3">
          {[
            ['What is a point?', 'A point is a unit of compute. Generating a 5-second 1080p video on Kling 03 costs about 12 points.'],
            ['Do points expire?', 'Subscription points roll over for 2 billing cycles. Top-up packs never expire.'],
            ['Can I cancel anytime?', 'Yes. You keep access until the end of the period and any unused points are still usable.'],
            ['Is there a student plan?', 'Yes — write to support with a .edu address and we’ll set you up with Pro at 50% off.'],
          ].map(([q, a]) => (
            <details key={q} className="panel p-5 group">
              <summary className="cursor-pointer flex items-center justify-between font-semibold text-text-primary">
                {q}
                <span className="text-text-muted group-open:rotate-180 transition">▾</span>
              </summary>
              <p className="mt-3 text-text-secondary leading-relaxed">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  )
}
