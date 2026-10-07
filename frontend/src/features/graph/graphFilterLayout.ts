export interface FilterLayoutNode {
  id: string
  lane: number
  x: number
  y: number
  height: number
  matched: boolean
  memberOf?: string
}

/** 조건 일치 영역이 모든 레인에서 비일치 영역보다 위에 오도록 배치한다. 복원용 좌표는 보관하지 않는다. */
export function highlightPositions(nodes: readonly FilterLayoutNode[], laneCount: number): Record<string, { x: number; y: number }> | null {
  if (!nodes.some(node => node.matched)) return null
  const byId = new Map(nodes.map(node => [node.id, node]))
  const columns = Array.from({ length: laneCount }, (_, lane) => nodes.filter(node => node.lane === lane))
  const positions: Record<string, { x: number; y: number }> = {}
  const order = (left: FilterLayoutNode, right: FilterLayoutNode) => {
    const a = byId.get(left.memberOf ?? "") ?? left, b = byId.get(right.memberOf ?? "") ?? right
    return a.y - b.y || a.id.localeCompare(b.id) || Number(!!left.memberOf) - Number(!!right.memberOf) || left.y - right.y || left.id.localeCompare(right.id)
  }
  const stack = (items: readonly FilterLayoutNode[], top: number) => {
    let bottom = top
    for (const node of [...items].sort(order)) {
      positions[node.id] = { x: node.x, y: bottom + node.height / 2 }
      bottom += node.height + 20
    }
    return items.length ? bottom - 20 : top
  }
  const bottom = Math.max(...columns.map(column => stack(column.filter(node => node.matched), 64)))
  for (const column of columns) stack(column.filter(node => !node.matched), bottom + 40)
  return positions
}
