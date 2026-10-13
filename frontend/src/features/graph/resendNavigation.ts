// One-shot navigation, scoped to the current project dataset. Never put evidence IDs in the URL.
let pending: { eventId: string; revision: number } | null = null

export function openResendSelection(eventId: string, revision: number) {
  pending = { eventId, revision }
  window.location.hash = "graph"
}

export function takeResendSelection(revision: number): string | null {
  const selected = pending
  pending = null
  return selected?.revision === revision ? selected.eventId : null
}
