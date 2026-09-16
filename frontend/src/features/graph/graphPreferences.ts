import { clampLaneWidth, defaultLaneWidths } from "./graphLanes"

// v5 저장값은 레인 폭만 기본값으로 채워 이어 쓴다. 키를 바꾸면 사용자가 잡아둔 노드 위치가 모두 사라진다.
export const GRAPH_PREFERENCES_KEY = "flowscope.graph.preferences.v5"
export const LANE_COUNTS = ["2", "3"] as const
const MAX_POSITIONS = 500
const MAX_KEY_LENGTH = 256
const MAX_SERIALIZED_LENGTH = 256 * 1024

export type GraphLaneWidths = Record<(typeof LANE_COUNTS)[number], number[]>

export type GraphPreferences = {
  version: 6
  positions: Record<string, { x: number; y: number }>
  viewport: { zoom: number; pan: { x: number; y: number } } | null
  locked: boolean
  inputMode: "auto" | "trackpad" | "mouse"
  laneWidths: GraphLaneWidths
}

export function defaultGraphLaneWidths(): GraphLaneWidths {
  return { 2: defaultLaneWidths(2), 3: defaultLaneWidths(3) }
}

function validateLaneWidths(value: unknown): GraphLaneWidths | null {
  if (value === undefined) return defaultGraphLaneWidths()
  if (!plainRecord(value) || Object.keys(value).some((key) => !LANE_COUNTS.includes(key as (typeof LANE_COUNTS)[number]))) return null
  const widths = defaultGraphLaneWidths()
  for (const count of LANE_COUNTS) {
    const lane = value[count]
    if (lane === undefined) continue
    if (!Array.isArray(lane) || lane.length !== Number(count) || lane.some((width) => typeof width !== "number" || !Number.isFinite(width))) return null
    widths[count] = lane.map(clampLaneWidth)
  }
  return widths
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function safeKey(key: string) { return key.length <= MAX_KEY_LENGTH && key !== "__proto__" && key !== "constructor" && key !== "prototype" }
function point(value: unknown): value is { x: number; y: number } { return plainRecord(value) && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y) }

export function validateGraphPreferences(value: unknown): GraphPreferences | null {
  const keys = plainRecord(value) ? Object.keys(value) : []
  if (!plainRecord(value) || !["version", "positions", "viewport", "locked"].every((key) => Object.hasOwn(value, key)) || keys.some(key => !["version", "positions", "viewport", "locked", "inputMode", "laneWidths"].includes(key)) || (value.version !== 5 && value.version !== 6) || typeof value.locked !== "boolean" || !plainRecord(value.positions)) return null
  const inputMode = value.inputMode ?? "auto"
  if (inputMode !== "auto" && inputMode !== "trackpad" && inputMode !== "mouse") return null
  const laneWidths = validateLaneWidths(value.laneWidths)
  if (!laneWidths) return null
  const entries = Object.entries(value.positions)
  if (entries.length > MAX_POSITIONS || entries.some(([key, position]) => !safeKey(key) || !point(position))) return null
  const viewport = value.viewport
  if (viewport !== null && (!plainRecord(viewport) || typeof viewport.zoom !== "number" || !Number.isFinite(viewport.zoom) || !point(viewport.pan))) return null
  const positions = Object.fromEntries(entries.map(([key, position]) => {
    const coordinate = position as { x: number; y: number }
    return [key, { x: coordinate.x, y: coordinate.y }]
  }))
  const normalizedViewport = viewport === null ? null : (() => {
    const validViewport = viewport as { zoom: number; pan: { x: number; y: number } }
    return { zoom: Math.min(2, Math.max(0.4, validViewport.zoom)), pan: { x: validViewport.pan.x, y: validViewport.pan.y } }
  })()
  return { version: 6, positions, viewport: normalizedViewport, locked: value.locked, inputMode, laneWidths }
}

export function loadGraphPreferences(storage: Storage = window.localStorage): GraphPreferences | null {
  try { const raw = storage.getItem(GRAPH_PREFERENCES_KEY); return raw && raw.length <= MAX_SERIALIZED_LENGTH ? validateGraphPreferences(JSON.parse(raw)) : null } catch { return null }
}

export function saveGraphPreferences(value: GraphPreferences, storage: Storage = window.localStorage): boolean {
  const valid = validateGraphPreferences(value)
  if (!valid) return false
  try { storage.setItem(GRAPH_PREFERENCES_KEY, JSON.stringify(valid)); return true } catch { return false }
}

export function resetGraphPreferences(storage: Storage = window.localStorage) { storage.removeItem(GRAPH_PREFERENCES_KEY) }
