export type GraphLane = "identity" | "endpoint" | "object"

export interface LaneGeometry {
  left: number
  right: number
  anchor: number
}

export function graphLaneForKind(kind: string): GraphLane {
  if (kind === "identity") return "identity"
  if (kind === "resource") return "object"
  return "endpoint"
}

export function laneGeometry(width: number, lane: GraphLane, gutter = 24): LaneGeometry {
  const safeWidth = Math.max(0, width)
  const laneWidth = safeWidth / 3
  const laneIndex = lane === "identity" ? 0 : lane === "endpoint" ? 1 : 2
  const safeGutter = Math.min(Math.max(0, gutter), laneWidth / 2)
  const laneLeft = laneIndex * laneWidth
  return {
    left: laneLeft + safeGutter,
    right: laneLeft + laneWidth - safeGutter,
    anchor: laneLeft + laneWidth / 2,
  }
}

export function clampRenderedPosition(position: { x: number; y: number }, lane: LaneGeometry): { x: number; y: number } {
  return { x: Math.min(lane.right, Math.max(lane.left, position.x)), y: position.y }
}
