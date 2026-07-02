import Logo from "./Logo";
import { useLanguage } from "../i18n/LanguageContext";

export default function Footer() {
  const { t } = useLanguage();

  const cols = [
    {
      title: t.footer_col_product,
      links: [
        t.footer_link_seedance,
        t.footer_link_blog,
        t.footer_link_app,
        t.footer_link_openclaw,
      ],
    },
    {
      title: t.footer_col_legal,
      links: [
        t.footer_link_privacy,
        t.footer_link_terms,
        t.footer_link_pricing,
        t.footer_link_contact,
      ],
    },
    {
      title: t.footer_col_resources,
      links: [
        t.footer_link_discord,
        t.footer_link_docs,
        t.footer_link_status,
        t.footer_link_changelog,
      ],
    },
  ];

  return (
    <footer className="mt-24 pt-12 pb-10 border-t border-border">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-10">
        <div className="col-span-2 md:col-span-2 max-w-sm">
          <Logo />
          <p className="mt-4 text-sm text-text-secondary leading-relaxed">{t.hero_subtitle}</p>
        </div>

        {cols.map((c) => (
          <div key={c.title}>
            <h4 className="text-text-primary font-semibold mb-4">{c.title}</h4>
            <ul className="space-y-2.5 text-sm">
              {c.links.map((l) => (
                <li key={l}>
                  <a href="#" className="text-text-secondary hover:text-accent transition">
                    {l}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div>
          <h4 className="text-text-primary font-semibold mb-4">{t.footer_col_contact}</h4>
          <p className="text-sm text-text-secondary">{t.footer_support_label}</p>
          <a href="mailto:hello@doopoo.ai" className="text-sm gradient-text font-medium">
            hello@doopoo.ai
          </a>
        </div>
      </div>

      <div className="mt-10 pt-6 border-t border-border flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-text-muted">
        <span>{t.footer_rights}</span>
        <span className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          {t.footer_status}
        </span>
      </div>
    </footer>
  );
}
