import { createFileRoute } from "@tanstack/react-router";
import Scripts from "../pages/Scripts";

export const Route = createFileRoute("/scripts/")({
  component: Scripts,
});
