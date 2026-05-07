import { createFileRoute } from "@tanstack/react-router";
import Scripts from "../pages/Scripts";

export const Route = createFileRoute("/scripts")({
  head: () => ({ meta: [{ title: "Scripts — Doopoo" }, { name: "description", content: "Generate and edit AI-assisted scripts." }] }),
  component: Scripts,
});
