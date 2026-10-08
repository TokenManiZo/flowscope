export interface FilterLayoutNode {
  id: string
  lane: number
  x: number
  y: number
  matched: boolean
}

/** 왼쪽 레인은 고정하고, 나머지 레인의 기존 좌표 자리 안에서 일치 노드를 먼저 놓는다. */
export function highlightPositions(nodes: readonly FilterLayoutNode[], laneCount: number): Record<string, { x: number; y: number }> | null {
  if (!nodes.some(node => node.lane > 0 && node.matched)) return null
  const positions: Record<string, { x: number; y: number }> = {}
  for (const node of nodes) positions[node.id] = { x: node.x, y: node.y }
  for (let lane = 1; lane < laneCount; lane++) {
    const slots = nodes.filter(node => node.lane === lane).sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
    const ordered = [...slots.filter(node => node.matched), ...slots.filter(node => !node.matched)]
    ordered.forEach((node, index) => { positions[node.id] = { x: slots[index].x, y: slots[index].y } })
  }
  return positions
}

/** Opened objects form one ordered block; their connected identities/APIs precede unrelated nodes. */
export function focusedGroupPositions(nodes: readonly (FilterLayoutNode & { height: number; memberOf: string })[], laneCount: number): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {}
  for (let lane = 0; lane < laneCount; lane++) {
    const column = nodes.filter(node => node.lane === lane)
    const blocks = new Map<string, typeof column>()
    for (const node of column) {
      const key = node.memberOf || node.id
      const block = blocks.get(key) ?? []; block.push(node); blocks.set(key, block)
    }
    const ordered = [...blocks.values()].sort((a, b) => Number(b.some(node => node.matched)) - Number(a.some(node => node.matched))
      || Math.min(...a.map(node => node.y)) - Math.min(...b.map(node => node.y)))
    let cursor = Math.min(...column.map(node => node.y - node.height / 2))
    for (const block of ordered) {
      // Projection inserts OBJ members in ordinal order, independent of their previous coordinates.
      const members = [...block.filter(node => !node.memberOf), ...block.filter(node => node.memberOf)]
      for (const node of members) {
        positions[node.id] = { x: node.x, y: cursor + node.height / 2 }
        cursor += node.height + 20
      }
    }
  }
  return positions
}
