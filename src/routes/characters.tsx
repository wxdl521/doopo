import { createFileRoute } from "@tanstack/react-router";
import Characters from "../pages/Characters";
import { RequireAuth } from "../components/RequireAuth";

function CharactersRoute() {
  return (
    <RequireAuth>
      <Characters />
    </RequireAuth>
  );
}

export const Route = createFileRoute("/characters")({
  head: () => ({
    meta: [
      { title: "Characters — Doopoo" },
      { name: "description", content: "Design and manage AI characters." },
    ],
  }),
  component: CharactersRoute,
});
