import { createFileRoute } from "@tanstack/react-router";
import ScriptNew from "../pages/ScriptNew";

export const Route = createFileRoute("/scripts/new")({
  head: () => ({ meta: [{ title: "New Script — Doopoo" }, { name: "description", content: "Generate a new AI-assisted script with templates and parameters." }] }),
  component: ScriptNew,
});