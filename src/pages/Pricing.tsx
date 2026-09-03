import { Check, Sparkles, Star, Zap } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useLanguage } from "../i18n/LanguageContext";
import { useAuth } from "../hooks/useAuth";

type Plan = {
  id: string;
  name: string;
  tagline: string;
  monthly: number;
  yearly: number;
  points: number;
  features: string[];
  highlight?: boolean;
  ribbon?: string;
};

export default function Pricing() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [annual, setAnnual] = useState(true);

  const onChoosePlan = (planId: string) => {
    if (planId === "free") {
      void navigate({ to: isAuthenticated ? "/home" : "/register" });
      return;
    }
    if (!isAuthenticated) {
      void navigate({ to: "/login", search: { redirect: "/account/credits" } });
      return;
    }
    void navigate({ to: "/account/credits" });
  };

  const plans: Plan[] = [
    {
      id: "free",
      name: t.pricing_plan_starter_name,
      tagline: t.pricing_plan_starter_tag,
      monthly: 0,
      yearly: 0,
      points: 70,
      features: [
        t.pricing_plan_starter_f1,
        t.pricing_plan_starter_f2,
        t.pricing_plan_starter_f3,
        t.pricing_plan_starter_f4,
      ],
    },
    {
      id: "pro",
      name: t.pricing_plan_pro_name,
      tagline: t.pricing_plan_pro_tag,
      monthly: 29,
      yearly: 290,
      points: 2400,
      features: [
        t.pricing_plan_pro_f1,
        t.pricing_plan_pro_f2,
        t.pricing_plan_pro_f3,
        t.pricing_plan_pro_f4,
        t.pricing_plan_pro_f5,
      ],
      highlight: true,
      ribbon: t.pricing_ribbon_popular,
    },
    {
      id: "studio",
      name: t.pricing_plan_studio_name,
      tagline: t.pricing_plan_studio_tag,
      monthly: 99,
      yearly: 990,
      points: 12000,
      features: [
        t.pricing_plan_studio_f1,
        t.pricing_plan_studio_f2,
        t.pricing_plan_studio_f3,
        t.pricing_plan_studio_f4,
        t.pricing_plan_studio_f5,
      ],
    },
  ];

  const faq: Array<[string, string]> = [
    [t.pricing_faq_q1, t.pricing_faq_a1],
    [t.pricing_faq_q2, t.pricing_faq_a2],
    [t.pricing_faq_q3, t.pricing_faq_a3],
    [t.pricing_faq_q4, t.pricing_faq_a4],
  ];

  return (
    <div className="animate-fade-in">
      <div className="text-center mb-10">
        <h1 className="font-display text-4xl md:text-5xl font-bold">
          {t.pricing_title_p1} <span className="gradient-text">{t.pricing_title_p2}</span>.
        </h1>
        <p className="text-text-secondary mt-3 max-w-2xl mx-auto">{t.pricing_subtitle}</p>

        <div className="mt-6 inline-flex items-center gap-1 p-1 rounded-full bg-bg-elevated border border-border">
          <button
            onClick={() => setAnnual(false)}
            className={`px-4 py-1.5 rounded-full text-sm transition ${!annual ? "bg-accent text-bg font-semibold" : "text-text-secondary"}`}
          >
            {t.pricing_billing_monthly}
          </button>
          <button
            onClick={() => setAnnual(true)}
            className={`px-4 py-1.5 rounded-full text-sm transition ${annual ? "bg-accent text-bg font-semibold" : "text-text-secondary"}`}
          >
            {t.pricing_billing_annual}{" "}
            <span className="ml-1 text-[10px] uppercase tracking-wider">
              {t.pricing_save_badge}
            </span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-6xl mx-auto">
        {plans.map((p) => {
          const price = annual ? Math.round(p.yearly / 12) : p.monthly;
          return (
            <div
              key={p.id}
              className={`relative panel p-7 flex flex-col ${
                p.highlight
                  ? "border-accent/60 shadow-glow-lg bg-gradient-to-b from-accent-dim/10 to-transparent"
                  : ""
              }`}
            >
              {p.ribbon && (
                <span
                  className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full
                                 bg-accent text-bg text-xs font-bold uppercase tracking-wider shadow-glow flex items-center gap-1"
                >
                  <Star size={12} fill="currentColor" /> {p.ribbon}
                </span>
              )}

              <div>
                <h3 className="font-display text-2xl font-bold">{p.name}</h3>
                <p className="text-text-secondary text-sm mt-1">{p.tagline}</p>
              </div>

              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-display font-bold">${price}</span>
                <span className="text-text-muted">{t.pricing_per_month}</span>
                {annual && p.monthly > 0 && (
                  <span className="ml-2 text-xs text-text-muted line-through">${p.monthly}</span>
                )}
              </div>
              <div className="mt-1 text-sm text-accent flex items-center gap-1.5">
                <Zap size={13} /> {p.points.toLocaleString()} {t.pricing_points_suffix}
              </div>

              <button
                type="button"
                onClick={() => onChoosePlan(p.id)}
                className={`mt-6 w-full justify-center ${p.highlight ? "btn-primary" : "btn-outline"}`}
              >
                <Sparkles size={14} />{" "}
                {p.id === "free" ? t.pricing_start_free : t.pricing_choose_credits}
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
          );
        })}
      </div>

      <section className="mt-20 max-w-4xl mx-auto">
        <h2 className="font-display text-2xl font-bold mb-5">{t.pricing_faq_title}</h2>
        <div className="space-y-3">
          {faq.map(([q, a]) => (
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
  );
}
