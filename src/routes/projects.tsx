import { createFileRoute } from "@tanstack/react-router";
import Projects from "../pages/Projects";

export const Route = createFileRoute("/projects")({
  head: () => ({
    meta: [
      { title: "Projects — Doopoo" },
      { name: "description", content: "Manage your Doopoo creative projects." },
    ],
  }),
  component: Projects,
});
