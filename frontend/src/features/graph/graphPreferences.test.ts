import { beforeEach, describe, expect, it } from "vitest"

import { MAX_LANE_WIDTH, MIN_LANE_WIDTH } from "./graphLanes"
import { defaultGraphLaneWidths, GRAPH_PREFERENCES_KEY, loadGraphPreferences, resetGraphPreferences, saveGraphPreferences } from "./graphPreferences"

let storage: Storage
beforeEach(() => {
  const values = new Map<string, string>()
  storage = { get length() { return values.size }, clear: () => values.clear(), getItem: key => values.get(key) ?? null, key: index => [...values.keys()][index] ?? null, removeItem: key => { values.delete(key) }, setItem: (key, value) => { values.set(key, value) } }
})

describe("graph preferences", () => {
  it("normalizes out-of-range restored viewport zoom while retaining semantic hierarchy positions", () => {
    for (const [zoom, expected] of [[0, 0.4], [100, 2]]) {
      storage.setItem(GRAPH_PREFERENCES_KEY, JSON.stringify({ version: 6, positions: { 'api-group:["Target","orders"]': { x: -999, y: 125 } }, viewport: { zoom, pan: { x: -1000, y: 50 } }, locked: true }))
      expect(loadGraphPreferences(storage)).toEqual({ version: 6, positions: { 'api-group:["Target","orders"]': { x: -999, y: 125 } }, viewport: { zoom: expected, pan: { x: -1000, y: 50 } }, locked: true, inputMode: "auto", laneWidths: defaultGraphLaneWidths() })
    }
  })
  it("round-trips only the versioned layout preference shape", () => {
    saveGraphPreferences({ version: 6, positions: { "operation:GET /orders": { x: 12, y: 24 } }, viewport: { zoom: 1.2, pan: { x: 5, y: -4 } }, locked: true, inputMode: "trackpad", laneWidths: { 2: [300, 420], 3: [360, 480, 360] } }, storage)
    expect(loadGraphPreferences(storage)).toEqual({ version: 6, positions: { "operation:GET /orders": { x: 12, y: 24 } }, viewport: { zoom: 1.2, pan: { x: 5, y: -4 } }, locked: true, inputMode: "trackpad", laneWidths: { 2: [300, 420], 3: [360, 480, 360] } })
    expect(storage.getItem(GRAPH_PREFERENCES_KEY)).not.toContain("evidence")
  })

  it("carries a v5 layout forward with default lane widths instead of dropping saved positions", () => {
    storage.setItem(GRAPH_PREFERENCES_KEY, JSON.stringify({ version: 5, positions: { "operation:GET /orders": { x: 12, y: 24 } }, viewport: null, locked: false }))
    expect(loadGraphPreferences(storage)).toEqual({ version: 6, positions: { "operation:GET /orders": { x: 12, y: 24 } }, viewport: null, locked: false, inputMode: "auto", laneWidths: defaultGraphLaneWidths() })
  })

  it("clamps restored lane widths and rejects a malformed lane width map", () => {
    storage.setItem(GRAPH_PREFERENCES_KEY, JSON.stringify({ version: 6, positions: {}, viewport: null, locked: false, laneWidths: { 3: [10, 9999, 400] } }))
    expect(loadGraphPreferences(storage)?.laneWidths).toEqual({ 2: defaultGraphLaneWidths()[2], 3: [MIN_LANE_WIDTH, MAX_LANE_WIDTH, 400] })
    for (const laneWidths of [{ 3: [360, 360] }, { 4: [360, 360, 360, 360] }, { 3: [360, "wide", 360] }, [360, 360, 360]]) {
      storage.setItem(GRAPH_PREFERENCES_KEY, JSON.stringify({ version: 6, positions: {}, viewport: null, locked: false, laneWidths }))
      expect(loadGraphPreferences(storage)).toBeNull()
    }
  })

  it("rejects malformed, wrong-version, oversized, non-finite, and prototype-polluting values", () => {
    for (const value of [
      '{"version":4,"positions":{},"viewport":null,"locked":false}',
      '{"version":7,"positions":{},"viewport":null,"locked":false}',
      '{"version":6,"positions":{"node":{"x":null,"y":2}},"viewport":null,"locked":false}',
      '{"version":6,"positions":{"__proto__":{"x":1,"y":2}},"viewport":null,"locked":false}',
      '{"version":6,"positions":{},"viewport":null,"locked":false,"inputMode":"touch"}',
      JSON.stringify({ version: 6, positions: Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`node-${index}`, { x: index, y: index }])), viewport: null, locked: false }),
      JSON.stringify({ version: 6, positions: {}, viewport: null, locked: false, padding: "x".repeat(300_000) }),
      "not-json",
    ]) {
      storage.setItem(GRAPH_PREFERENCES_KEY, value)
      expect(loadGraphPreferences(storage)).toBeNull()
    }
  })

  it("reset removes only the namespaced graph value", () => {
    storage.setItem(GRAPH_PREFERENCES_KEY, "value")
    storage.setItem("unrelated", "keep")
    resetGraphPreferences(storage)
    expect(storage.getItem(GRAPH_PREFERENCES_KEY)).toBeNull()
    expect(storage.getItem("unrelated")).toBe("keep")
  })
})
