export const GRAPH_MIN_ZOOM = 0.4
export const GRAPH_MAX_ZOOM = 2
export const LANE_GUTTER = 24
export const MIN_LANE_WIDTH = 260
export const MAX_LANE_WIDTH = 1200
export const DEFAULT_LANE_WIDTH = 360

export interface LaneGeometry {
  left: number
  right: number
  anchor: number
}

export function laneIndexForKind(kind: string, laneCount: number): number {
  if (kind === "identity" || kind === "target") return 0
  if (laneCount <= 2) return 1
  return kind === "resource" ? 2 : 1
}

export function defaultLaneWidths(laneCount: number): number[] {
  return Array.from({ length: Math.max(0, laneCount) }, () => DEFAULT_LANE_WIDTH)
}

export function clampLaneWidth(width: number): number {
  return Number.isFinite(width) ? Math.min(MAX_LANE_WIDTH, Math.max(MIN_LANE_WIDTH, width)) : DEFAULT_LANE_WIDTH
}

/** 레인 경계는 모델 좌표다. pan·zoom은 화면 변환이므로 경계도 노드도 옮기지 않는다. */
export function laneBoundaries(widths: readonly number[]): number[] {
  return widths.reduce<number[]>((boundaries, width) => [...boundaries, boundaries[boundaries.length - 1] + clampLaneWidth(width)], [0])
}

export function laneGeometry(widths: readonly number[], index: number, gutter = LANE_GUTTER): LaneGeometry {
  const boundaries = laneBoundaries(widths)
  const left = boundaries[Math.min(Math.max(index, 0), Math.max(widths.length - 1, 0))] ?? 0
  const right = boundaries[Math.min(Math.max(index, 0), Math.max(widths.length - 1, 0)) + 1] ?? left + DEFAULT_LANE_WIDTH
  const safeGutter = Math.min(Math.max(0, gutter), (right - left) / 2)
  return { left: left + safeGutter, right: right - safeGutter, anchor: (left + right) / 2 }
}

/** 노드 폭까지 포함해 레인 안에 가둔다. 레인이 노드보다 좁으면 중앙에 세운다. */
export function clampLaneX(x: number, lane: LaneGeometry, nodeWidth: number): number {
  const half = Math.max(0, Number.isFinite(nodeWidth) ? nodeWidth : 0) / 2
  if (!Number.isFinite(x)) return lane.anchor
  return lane.right - lane.left < half * 2 ? lane.anchor : Math.min(lane.right - half, Math.max(lane.left + half, x))
}
