import { createFileRoute } from "@tanstack/react-router";
import AssetsLibrary from "../pages/AssetsLibrary";

export const Route = createFileRoute("/assets")({
  head: () => ({
    meta: [
      { title: "资产 — Doopoo" },
      { name: "description", content: "统一管理角色、场景、道具资产。" },
    ],
  }),
  component: AssetsLibrary,
});
