import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/team/')({
  component: TeamIndex,
})

function TeamIndex() {
  return <Navigate to="/my-team" />
}
