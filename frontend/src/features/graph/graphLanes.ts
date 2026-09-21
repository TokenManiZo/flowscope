export const GRAPH_MIN_ZOOM = 0.4
export const GRAPH_MAX_ZOOM = 2
/** 초기 배치와 레인 정렬이 쓰는 기준 간격(모델 좌표). 레인의 실제 범위는 노드가 만든다. */
export const LANE_SPACING = 360
/** 이웃 레인 노드와 최소로 벌리는 간격. */
export const LANE_GAP = 48

export interface LaneBounds {
  left: number
  right: number
}

export function laneCountForHierarchy(kind: string | undefined): number {
  return kind === "site" || kind === "group" ? 2 : 3
}

export function laneIndexForKind(kind: string, laneCount: number): number {
  if (kind === "identity" || kind === "target") return 0
  if (laneCount <= 2) return 1
  return kind === "resource" ? 2 : 1
}

export function laneAnchor(index: number): number {
  return (index + 0.5) * LANE_SPACING
}

/**
 * ponytail: 레인 폭을 따로 저장하지 않는다. 진실을 노드 위치 하나로 두어야 저장된 폭과 실제 배치가 어긋나지 않고,
 * 사용자가 노드를 바깥으로 끌면 레인 범위가 그만큼 자연히 넓어진다.
 */
export function laneLimits(bounds: ReadonlyArray<LaneBounds | null>, index: number, nodeWidth: number): { left: number; right: number } {
  const half = Math.max(0, Number.isFinite(nodeWidth) ? nodeWidth : 0) / 2
  const left = bounds.slice(0, index).reduce((limit, lane) => lane ? Math.max(limit, lane.right + LANE_GAP + half) : limit, Number.NEGATIVE_INFINITY)
  const right = bounds.slice(index + 1).reduce((limit, lane) => lane ? Math.min(limit, lane.left - LANE_GAP - half) : limit, Number.POSITIVE_INFINITY)
  return { left, right }
}

/** 이웃 레인을 넘지 않도록만 가둔다. 양쪽이 모두 좁으면 남은 가운데로 보낸다. */
export function clampBetweenLanes(x: number, limits: { left: number; right: number }): number {
  if (!Number.isFinite(x)) return Number.isFinite(limits.left) ? limits.left : Number.isFinite(limits.right) ? limits.right : 0
  if (limits.left > limits.right) return (limits.left + limits.right) / 2
  return Math.min(limits.right, Math.max(limits.left, x))
}
