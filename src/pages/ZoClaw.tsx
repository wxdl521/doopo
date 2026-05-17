import { ArrowRight, Bot, Check, Code2, Cpu, Workflow, Sparkles } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'

export default function DooClaw() {
  const { t } = useLanguage()
  const features = [
    { icon: Bot, title: t.zoclaw_feature1_title, body: t.zoclaw_feature1_body },
    { icon: Workflow, title: t.zoclaw_feature2_title, body: t.zoclaw_feature2_body },
    { icon: Code2, title: t.zoclaw_feature3_title, body: t.zoclaw_feature3_body },
    { icon: Cpu, title: t.zoclaw_feature4_title, body: t.zoclaw_feature4_body },
  ]
  const checklist = [t.zoclaw_check1, t.zoclaw_check2, t.zoclaw_check3, t.zoclaw_check4]

  return (
    <div className="animate-fade-in">
      <section className="relative overflow-hidden panel p-10 md:p-14">
        <div className="absolute -top-32 -right-20 w-[480px] h-[480px] bg-glow-orb opacity-70 blur-3xl pointer-events-none" />

        <div className="relative max-w-3xl">
          <span className="badge-points text-accent">
            <Sparkles size={14} /> {t.zoclaw_badge}
          </span>
          <h1 className="font-display text-4xl md:text-6xl font-bold mt-5 leading-tight">
            {t.zoclaw_title_p1} <span className="gradient-text">{t.zoclaw_title_p2}</span>.
          </h1>
          <p className="mt-5 text-text-secondary text-lg leading-relaxed">{t.zoclaw_subtitle}</p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button className="btn-primary"><Sparkles size={14} /> {t.zoclaw_try} <ArrowRight size={14} /></button>
            <button className="btn-outline">{t.zoclaw_docs}</button>
          </div>
        </div>
      </section>

      <section className="mt-16">
        <h2 className="font-display text-2xl md:text-3xl font-bold">{t.zoclaw_what_can_do}</h2>
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
          {features.map(({ icon: Icon, title, body }) => (
            <div key={title} className="panel p-6 group hover:border-accent/40 hover:shadow-glow transition">
              <div className="w-11 h-11 rounded-xl bg-accent-dim text-accent flex items-center justify-center
                              group-hover:bg-accent group-hover:text-bg transition">
                <Icon size={20} />
              </div>
              <h3 className="font-display text-xl font-bold mt-4">{title}</h3>
              <p className="text-text-secondary mt-1.5 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-16 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="panel p-8">
          <h3 className="font-display text-xl font-bold mb-4">{t.zoclaw_out_of_box}</h3>
          <ul className="space-y-3">
            {checklist.map((c) => (
              <li key={c} className="flex items-start gap-3">
                <span className="mt-1 w-5 h-5 rounded-full bg-accent text-bg flex items-center justify-center shrink-0">
                  <Check size={12} strokeWidth={3} />
                </span>
                <span className="text-text-secondary">{c}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel p-8 bg-gradient-to-br from-bg-soft via-bg-soft to-bg-surface">
          <h3 className="font-display text-xl font-bold mb-4">{t.zoclaw_api_taste}</h3>
          <pre className="text-xs md:text-sm bg-black/50 border border-border rounded-xl p-4 overflow-x-auto leading-relaxed">
{`POST /v1/dooclaw/run
{
  "prompt": "A hand-drawn forest spirit greets a lost child at dusk.",
  "model": "kling-03",
  "base":  "base_studio_ghibli_pack",
  "shots": 6,
  "duration": "0:42"
}`}
          </pre>
          <p className="mt-3 text-xs text-text-muted">{t.zoclaw_api_returns}</p>
        </div>
      </section>
    </div>
  )
}
