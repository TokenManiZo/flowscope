export interface SelectionLayoutNode {
  id: string
  lane: number
  kind: string
  x: number
  y: number
  height: number
  connected: boolean
}

export const isSelectionAnchorKind = (kind: string) => ["operation", "operation-group", "observed-operation", "support-operation", "resend-operation", "resource", "object-group"].includes(kind)

/** Place connected lanes around the clicked card, keeping its lane and the camera fixed. */
export function selectionPositions(nodes: readonly SelectionLayoutNode[], selectedId: string, laneCount: number, viewport?: { top: number; bottom: number }): Record<string, { x: number; y: number }> {
  const anchor = nodes.find(node => node.id === selectedId)
  if (laneCount !== 3 || !anchor || !isSelectionAnchorKind(anchor.kind)) return {}
  const positions: Record<string, { x: number; y: number }> = {}
  for (let lane = 0; lane < laneCount; lane++) {
    if (lane === anchor.lane) continue
    const column = nodes.filter(node => node.lane === lane).sort((a, b) => a.y - b.y || a.id.localeCompare(b.id))
    const connected = column.filter(node => node.connected)
    if (!connected.length) continue
    // A partially visible card is already discoverable; only gather a lane with fully offscreen connections.
    if (viewport && !connected.some(node => node.y + node.height / 2 <= viewport.top || node.y - node.height / 2 >= viewport.bottom)) continue
    const height = connected.reduce((sum, node) => sum + node.height, 0) + 20 * (connected.length - 1)
    let cursor = anchor.y - height / 2
    for (const node of connected) {
      positions[node.id] = { x: node.x, y: cursor + node.height / 2 }
      cursor += node.height + 20
    }
    // Leave cards above the connected block alone; displace intersecting cards and following siblings.
    const top = anchor.y - height / 2
    for (const node of column.filter(node => !node.connected)) {
      if (node.y + node.height / 2 + 20 <= top) continue
      const y = Math.max(node.y, cursor + node.height / 2)
      positions[node.id] = { x: node.x, y }
      cursor = y + node.height / 2 + 20
    }
  }
  return positions
}
