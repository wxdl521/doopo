import { createFileRoute } from "@tanstack/react-router";
import Landing from "../pages/Landing";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Doopoo" },
      {
        name: "description",
        content: "Doopoo — let AI be your creative partner for scripts, characters, and video.",
      },
    ],
  }),
  component: Landing,
});
