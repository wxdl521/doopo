import { createFileRoute } from "@tanstack/react-router";
import Models from "../pages/Models";

export const Route = createFileRoute("/models")({
  head: () => ({ meta: [{ title: "Models — Doopoo" }, { name: "description", content: "Browse available AI models." }] }),
  component: Models,
});
