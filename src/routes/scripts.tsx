import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/scripts")({
  head: () => ({
    meta: [
      { title: "Scripts — Doopoo" },
      { name: "description", content: "Generate and edit AI-assisted scripts." },
    ],
  }),
  component: () => <Outlet />,
});
