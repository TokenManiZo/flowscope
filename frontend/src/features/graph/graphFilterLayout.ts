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
