// Cross-page selection only: no payloads, URL query values or persisted state.
type Selection = { page: "evidence" | "surface"; revision: number; evidenceId?: string; operation: string }
let pending: Selection | null = null
export function openEvidenceSelection(evidenceId: string, operation: string, revision: number) {
  pending = { page: "evidence", evidenceId, operation, revision }
  window.location.hash = "evidence"
}
export function openSurfaceSelection(operation: string, revision: number) {
  pending = { page: "surface", operation, revision }
  window.location.hash = "surface"
}
export function takePageSelection(page: Selection["page"], revision: number) {
  if (pending?.page !== page) return null
  const selection = pending
  pending = null
  return selection?.revision === revision ? selection : null
}
