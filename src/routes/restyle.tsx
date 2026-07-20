import { createFileRoute } from "@tanstack/react-router";
import RestyleStudio from "../components/restyle/RestyleStudio";

export const Route = createFileRoute("/restyle")({
  head: () => ({
    meta: [
      { title: "漫剧转绘 — Doopoo" },
      { name: "description", content: "Doopoo 漫剧转绘工作台演示原型。" },
    ],
  }),
  component: RestyleStudio,
});
