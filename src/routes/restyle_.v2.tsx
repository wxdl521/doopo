import { createFileRoute } from "@tanstack/react-router";
import RestyleV2Studio from "../components/restyle/v2/RestyleV2Studio";

export const Route = createFileRoute("/restyle_/v2")({
  head: () => ({
    meta: [
      { title: "漫剧转绘 v2 — Doopoo" },
      { name: "description", content: "Doopoo 漫剧转绘 v2：分析、审核、逐节点确认推进。" },
    ],
  }),
  component: RestyleV2Studio,
});
