import { createFileRoute } from "@tanstack/react-router";
import Home from "../pages/Home";

export const Route = createFileRoute("/home")({
  head: () => ({ meta: [{ title: "Doopoo — Home" }, { name: "description", content: "Doopoo home: AI prompts, models and quick actions." }] }),
  component: Home,
});
