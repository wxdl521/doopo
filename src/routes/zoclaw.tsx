import { createFileRoute } from "@tanstack/react-router";
import ZoClaw from "../pages/ZoClaw";

export const Route = createFileRoute("/zoclaw")({
  head: () => ({
    meta: [
      { title: "Openclaw — Doopoo" },
      { name: "description", content: "Openclaw: Doopoo's flagship creative engine." },
    ],
  }),
  component: ZoClaw,
});
