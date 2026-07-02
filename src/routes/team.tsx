import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/team")({
  head: () => ({
    meta: [{ title: "Team — Doopoo" }],
  }),
  component: TeamLayout,
});

function TeamLayout() {
  return (
    <div className="animate-fade-in">
      <Outlet />
    </div>
  );
}
