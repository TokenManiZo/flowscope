export interface FilterLayoutNode {
  id: string
  lane: number
  x: number
  y: number
  matched: boolean
  height?: number
  memberOf?: string
  temporary?: boolean
}

/** Keep the left lane fixed; compact matched API/Object blocks above the rest. */
export function highlightPositions(nodes: readonly FilterLayoutNode[], laneCount: number): Record<string, { x: number; y: number }> | null {
  if (!nodes.some(node => node.lane > 0 && node.matched)) return null
  const positions = focusedGroupPositions(nodes.map(node => ({ ...node, height: node.height ?? 60, memberOf: node.memberOf ?? "" })), laneCount)
  for (const node of nodes.filter(node => node.lane === 0)) positions[node.id] = { x: node.x, y: node.y }
  return positions
}

/** Compact base cards with connected blocks first; temporary OBJ cards overlay the background. */
export function focusedGroupPositions(nodes: readonly (FilterLayoutNode & { height: number; memberOf: string; opened?: boolean; temporary?: boolean })[], laneCount: number): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {}
  for (let lane = 0; lane < laneCount; lane++) {
    const column = nodes.filter(node => node.lane === lane)
    const base = column.filter(node => !node.temporary)
    let cursor = Math.min(...base.map(node => node.y - node.height / 2))
    const blocks = new Map<string, typeof base>()
    for (const node of base) {
      const key = node.memberOf || node.id
      const block = blocks.get(key) ?? []; block.push(node); blocks.set(key, block)
    }
    const ordered = [...blocks.values()].sort((a, b) => Number(b.some(node => node.opened)) - Number(a.some(node => node.opened))
      || Number(b.some(node => node.matched)) - Number(a.some(node => node.matched))
      || Math.min(...a.map(node => node.y)) - Math.min(...b.map(node => node.y)))
    for (const block of ordered) {
      for (const node of [...block.filter(node => !node.memberOf), ...block.filter(node => node.memberOf)]) {
        positions[node.id] = { x: node.x, y: cursor + node.height / 2 }
        cursor += node.height + 20
      }
    }
    for (const parent of base) {
      const children = column.filter(node => node.temporary && node.memberOf === parent.id)
      let childTop = positions[parent.id].y + parent.height / 2 + 20
      for (const child of children) {
        positions[child.id] = { x: positions[parent.id].x, y: childTop + child.height / 2 }
        childTop += child.height + 20
      }
    }
  }
  return positions
}
