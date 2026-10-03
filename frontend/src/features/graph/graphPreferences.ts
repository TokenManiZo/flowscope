// ponytail: 옛 버전도 같은 키로 읽는다. 키를 바꾸면 사용자가 잡아둔 노드 위치가 모두 사라진다.
export const GRAPH_PREFERENCES_KEY = "flowscope.graph.preferences.v5"
const MAX_POSITIONS = 500
const MAX_KEY_LENGTH = 256
const MAX_SERIALIZED_LENGTH = 256 * 1024

export type GraphPreferences = {
  version: 7
  positions: Record<string, { x: number; y: number }>
  viewport: { zoom: number; pan: { x: number; y: number } } | null
  locked: boolean
  inputMode: "auto" | "trackpad" | "mouse"
  /** 사용자가 모서리를 끌어 바꾼 노드 크기(모델 좌표). 구버전 이관용으로 v5~v7 저장값을 읽는다. */
  sizes?: Record<string, NodeSize>
}

export type NodeSize = { width: number; height: number }
/** 크기 저장값의 허용 범위. 기본 카드보다 작게 줄이거나 지나치게 키우지 않는다. */
export const NODE_SIZE_LIMIT = { minWidth: 160, minHeight: 60, maxWidth: 640, maxHeight: 480 } as const

function nodeSize(value: unknown): value is NodeSize {
  return plainRecord(value) && typeof value.width === "number" && Number.isFinite(value.width) && typeof value.height === "number" && Number.isFinite(value.height)
    && value.width >= NODE_SIZE_LIMIT.minWidth && value.width <= NODE_SIZE_LIMIT.maxWidth && value.height >= NODE_SIZE_LIMIT.minHeight && value.height <= NODE_SIZE_LIMIT.maxHeight
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function safeKey(key: string) { return key.length <= MAX_KEY_LENGTH && key !== "__proto__" && key !== "constructor" && key !== "prototype" }
function point(value: unknown): value is { x: number; y: number } { return plainRecord(value) && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y) }

export function validateGraphPreferences(value: unknown): GraphPreferences | null {
  const keys = plainRecord(value) ? Object.keys(value) : []
  if (!plainRecord(value) || !["version", "positions", "viewport", "locked"].every((key) => Object.hasOwn(value, key)) || keys.some(key => !["version", "positions", "viewport", "locked", "inputMode", "laneWidths", "sizes"].includes(key)) || ![5, 6, 7].includes(value.version as number) || typeof value.locked !== "boolean" || !plainRecord(value.positions)) return null
  const inputMode = value.inputMode ?? "auto"
  if (inputMode !== "auto" && inputMode !== "trackpad" && inputMode !== "mouse") return null
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
  const sizeEntries = value.sizes === undefined ? [] : plainRecord(value.sizes) ? Object.entries(value.sizes) : null
  if (sizeEntries === null || sizeEntries.length > MAX_POSITIONS || sizeEntries.some(([key, size]) => !safeKey(key) || !nodeSize(size))) return null
  const sizes = Object.fromEntries(sizeEntries.map(([key, size]) => [key, { width: (size as NodeSize).width, height: (size as NodeSize).height }]))
  return { version: 7, positions, viewport: normalizedViewport, locked: value.locked, inputMode, ...(sizeEntries.length ? { sizes } : {}) }
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
