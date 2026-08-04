import { createFileRoute } from "@tanstack/react-router";
import Projects from "../pages/Projects";
import { RequireAuth } from "../components/RequireAuth";

function ProjectsRoute() {
  return (
    <RequireAuth>
      <Projects />
    </RequireAuth>
  );
}

export const Route = createFileRoute("/projects")({
  head: () => ({
    meta: [
      { title: "Projects — Doopoo" },
      { name: "description", content: "Manage your Doopoo creative projects." },
    ],
  }),
  component: ProjectsRoute,
});
