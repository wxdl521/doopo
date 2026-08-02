import { createFileRoute } from "@tanstack/react-router";
import Transcribe from "../pages/Transcribe";

export const Route = createFileRoute("/transcribe")({
  head: () => ({
    meta: [
      { title: "台词稿转写 — Doopoo AI" },
      {
        name: "description",
        content: "上传配音音频或剧集视频，自动生成带时间码的台词稿，支持导出 SRT / TXT 与保存为剧本。",
      },
      { property: "og:title", content: "台词稿转写 — Doopoo AI" },
      {
        property: "og:description",
        content: "音视频一键转写为带时间码的台词稿，可导出字幕或直接沉淀为剧本。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Transcribe,
});