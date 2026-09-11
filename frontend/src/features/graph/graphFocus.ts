import type { HierarchyProjection } from "./graphHierarchy"

// Focus is presentation state, never an authorization or owner inference.
export function deriveGraphFocus(projection: HierarchyProjection | null, selectedElementId: string | null) {
  const identityNode = projection?.identities.find(node => node.id === selectedElementId)
  const identity = identityNode?.selection.identity
  const selectedEdge = projection?.edges.find(edge => edge.id === selectedElementId)
  const candidateKey = identity || selectedEdge ? "" : projection?.navigation.focusCandidateKey
  const active = Boolean(identity || selectedEdge || candidateKey)
  const overlaps = (left: readonly string[], right: readonly string[]) => left.some(value => right.includes(value))
  const edges = new Set(projection?.edges.filter(edge => {
    if (selectedEdge) {
      const selected = selectedEdge.selection
      const current = edge.selection
      return selected.source === current.source && selected.identity === current.identity && selected.operation === current.operation
        && (selected.resource === null || current.resource === null || selected.resource === current.resource)
        && (selectedEdge.relation === "candidate") === (edge.relation === "candidate")
        && (selected.cellKeys.length ? overlaps(selected.cellKeys, current.cellKeys) : edge.id === selectedEdge.id)
        && (selectedEdge.relation !== "candidate" || overlaps(selected.gapIds, current.gapIds))
    }
    return identity ? edge.selection.identity === identity
      : candidateKey && edge.relation === "candidate" && edge.selection.cellKeys.includes(candidateKey)
  }).map(edge => edge.id))
  return {
    identityNodeId: identityNode?.id ?? null,
    edgeState: (id: string): "yes" | "no" | "none" => active ? edges.has(id) ? "yes" : "no" : "none",
  }
}
