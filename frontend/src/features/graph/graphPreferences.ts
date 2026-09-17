export const GRAPH_PREFERENCES_KEY = "flowscope.graph.preferences.v5"
const MAX_POSITIONS = 500
const MAX_KEY_LENGTH = 256
const MAX_SERIALIZED_LENGTH = 256 * 1024

export type GraphPreferences = {
  version: 5
  positions: Record<string, { x: number; y: number }>
  viewport: { zoom: number; pan: { x: number; y: number } } | null
  locked: boolean
  inputMode: "auto" | "trackpad" | "mouse"
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function safeKey(key: string) { return key.length <= MAX_KEY_LENGTH && key !== "__proto__" && key !== "constructor" && key !== "prototype" }
function point(value: unknown): value is { x: number; y: number } { return plainRecord(value) && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y) }

export function validateGraphPreferences(value: unknown): GraphPreferences | null {
  const keys = plainRecord(value) ? Object.keys(value) : []
  if (!plainRecord(value) || !["version", "positions", "viewport", "locked"].every((key) => Object.hasOwn(value, key)) || keys.some(key => !["version", "positions", "viewport", "locked", "inputMode"].includes(key)) || value.version !== 5 || typeof value.locked !== "boolean" || !plainRecord(value.positions)) return null
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
  return { version: 5, positions, viewport: normalizedViewport, locked: value.locked, inputMode }
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
