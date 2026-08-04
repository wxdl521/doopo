import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequireAuth } from "../components/RequireAuth";

function ScriptsLayout() {
  return (
    <RequireAuth>
      <Outlet />
    </RequireAuth>
  );
}

export const Route = createFileRoute("/scripts")({
  head: () => ({
    meta: [
      { title: "Scripts — Doopoo" },
      { name: "description", content: "Generate and edit AI-assisted scripts." },
    ],
  }),
  component: ScriptsLayout,
});
