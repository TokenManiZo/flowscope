export const GRAPH_MIN_ZOOM = 0.4
export const GRAPH_MAX_ZOOM = 2
export const LANE_GUTTER = 24
export const MIN_LANE_WIDTH = 260
export const MAX_LANE_WIDTH = 1200
export const DEFAULT_LANE_WIDTH = 360

/** 레인별 강조색: IDENTITY·API·OBJECT 순. 노드가 레인을 벗어나도 소속을 읽을 수 있게 배경 띠와 카드 스트립이 같은 색을 쓴다. */
export const LANE_ACCENTS = ["#93c5fd", "#5eead4", "#c4b5fd"] as const

export function laneAccentForKind(kind: string): string {
  if (kind === "identity" || kind === "target") return LANE_ACCENTS[0]
  return kind === "resource" ? LANE_ACCENTS[2] : LANE_ACCENTS[1]
}

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
