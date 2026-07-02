import { createFileRoute } from "@tanstack/react-router";
import Bases from "../pages/Bases";

export const Route = createFileRoute("/bases")({
  head: () => ({
    meta: [
      { title: "Assets — Doopoo" },
      { name: "description", content: "Browse and manage your asset bases." },
    ],
  }),
  component: Bases,
});
