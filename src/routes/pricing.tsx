import { createFileRoute } from "@tanstack/react-router";
import Pricing from "../pages/Pricing";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Doopoo" },
      { name: "description", content: "Doopoo pricing plans." },
    ],
  }),
  component: Pricing,
});
