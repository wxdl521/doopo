import { createFileRoute } from "@tanstack/react-router";
import Showcase from "../pages/Showcase";

export const Route = createFileRoute("/showcase")({
  head: () => ({
    meta: [
      { title: "Showcase — Doopoo" },
      { name: "description", content: "Community showcase of Doopoo creations." },
    ],
  }),
  component: Showcase,
});
