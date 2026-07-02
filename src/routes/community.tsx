import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/community")({
  head: () => ({
    meta: [
      { title: "社区精选 — Doopoo" },
      { name: "description", content: "社区用户分享的剧本、角色、场景、道具与漫剧。" },
    ],
  }),
  component: () => <Outlet />,
});
