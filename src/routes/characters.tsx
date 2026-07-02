import { createFileRoute } from "@tanstack/react-router";
import Characters from "../pages/Characters";

export const Route = createFileRoute("/characters")({
  head: () => ({
    meta: [
      { title: "Characters — Doopoo" },
      { name: "description", content: "Design and manage AI characters." },
    ],
  }),
  component: Characters,
});
