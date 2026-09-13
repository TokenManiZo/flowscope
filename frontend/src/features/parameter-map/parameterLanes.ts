import { parameterLaneOrder, type ParameterLane } from "./parameterProjection"

export interface ParameterLaneGeometry {
  laneLeft: number
  laneRight: number
  left: number
  right: number
  anchor: number
  /** Effective rendered width and zoom; the renderer must apply zoom before clamping. */
  nodeWidth: number
  zoom: number
  maxZoom: number
  fallback: boolean
}

/** Width and returned coordinates are rendered pixels, positions are node centers. */
export function parameterLaneGeometry(width: number, lane: ParameterLane, nodeWidth: number, zoom = 1): ParameterLaneGeometry {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0
  const safeNodeWidth = Number.isFinite(nodeWidth) && nodeWidth > 0 ? nodeWidth : 186
  const laneWidth = safeWidth / 4, index = parameterLaneOrder.indexOf(lane)
  const laneLeft = index * laneWidth, laneRight = laneLeft + laneWidth
  const gutter = Math.min(12, Math.max(0, (laneWidth - safeNodeWidth) / 2))
  const maxZoom = Math.max(0, (laneWidth - 2 * gutter) / safeNodeWidth)
  const effectiveZoom = Math.min(Number.isFinite(zoom) && zoom > 0 ? zoom : 1, maxZoom)
  const renderedWidth = Math.min(laneWidth - 2 * gutter, safeNodeWidth * effectiveZoom)
  return { laneLeft, laneRight, left: laneLeft + gutter + renderedWidth / 2, right: laneRight - gutter - renderedWidth / 2, anchor: laneLeft + laneWidth / 2, nodeWidth: renderedWidth, zoom: effectiveZoom, maxZoom, fallback: safeWidth < 900 }
}

export function clampParameterNode(position: { x: number; y: number }, geometry: ParameterLaneGeometry): { x: number; y: number } {
  return { x: Math.min(geometry.right, Math.max(geometry.left, Number.isFinite(position.x) ? position.x : geometry.anchor)), y: Number.isFinite(position.y) ? position.y : 0 }
}
