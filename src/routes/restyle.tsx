import { createFileRoute } from "@tanstack/react-router";
import { Palette } from "lucide-react";
import { useLanguage } from "../i18n/LanguageContext";

export const Route = createFileRoute("/restyle")({
  head: () => ({
    meta: [
      { title: "转绘 — Doopoo" },
      { name: "description", content: "Doopoo 转绘功能即将推出。" },
    ],
  }),
  component: RestylePlaceholder,
});

function RestylePlaceholder() {
  const { lang } = useLanguage();
  const chinese = lang === "zh";
  return (
    <section className="max-w-3xl mx-auto panel p-10 text-center">
      <div className="w-14 h-14 rounded-2xl bg-accent-dim text-accent grid place-items-center mx-auto mb-4">
        <Palette size={26} />
      </div>
      <h1 className="font-display text-2xl font-bold">{chinese ? "转绘" : "Restyle"}</h1>
      <p className="text-text-secondary mt-3">
        {chinese
          ? "转绘功能正在规划中，后续可在这里将素材转换为指定视觉风格。"
          : "Restyle is being planned. This is where you will transform assets into a chosen visual style."}
      </p>
      <span className="inline-flex mt-5 px-2.5 py-1 rounded-full text-xs border border-accent/30 bg-accent-dim text-accent">
        {chinese ? "即将推出" : "Coming soon"}
      </span>
    </section>
  );
}
