import { describe, expect, it } from "vitest"

import { GRAPH_PREFERENCES_KEY, loadGraphPreferences, resetGraphPreferences, saveGraphPreferences } from "./graphPreferences"

describe("graph preferences", () => {
  it("normalizes out-of-range restored viewport zoom while retaining semantic hierarchy positions", () => {
    for (const [zoom, expected] of [[0, 0.4], [100, 2]]) {
      localStorage.setItem(GRAPH_PREFERENCES_KEY, JSON.stringify({ version: 5, positions: { 'api-group:["Target","orders"]': { x: -999, y: 125 } }, viewport: { zoom, pan: { x: -1000, y: 50 } }, locked: true }))
      expect(loadGraphPreferences()).toEqual({ version: 5, positions: { 'api-group:["Target","orders"]': { x: -999, y: 125 } }, viewport: { zoom: expected, pan: { x: -1000, y: 50 } }, locked: true })
    }
  })
  it("round-trips only the versioned layout preference shape", () => {
    saveGraphPreferences({ version: 5, positions: { "operation:GET /orders": { x: 12, y: 24 } }, viewport: { zoom: 1.2, pan: { x: 5, y: -4 } }, locked: true })
    expect(loadGraphPreferences()).toEqual({ version: 5, positions: { "operation:GET /orders": { x: 12, y: 24 } }, viewport: { zoom: 1.2, pan: { x: 5, y: -4 } }, locked: true })
    expect(localStorage.getItem(GRAPH_PREFERENCES_KEY)).not.toContain("evidence")
  })

  it("rejects malformed, wrong-version, oversized, non-finite, and prototype-polluting values", () => {
    for (const value of [
      '{"version":4,"positions":{},"viewport":null,"locked":false}',
      '{"version":5,"positions":{"node":{"x":null,"y":2}},"viewport":null,"locked":false}',
      '{"version":5,"positions":{"__proto__":{"x":1,"y":2}},"viewport":null,"locked":false}',
      JSON.stringify({ version: 5, positions: Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`node-${index}`, { x: index, y: index }])), viewport: null, locked: false }),
      JSON.stringify({ version: 5, positions: {}, viewport: null, locked: false, padding: "x".repeat(300_000) }),
      "not-json",
    ]) {
      localStorage.setItem(GRAPH_PREFERENCES_KEY, value)
      expect(loadGraphPreferences()).toBeNull()
    }
  })

  it("reset removes only the namespaced graph value", () => {
    localStorage.setItem(GRAPH_PREFERENCES_KEY, "value")
    localStorage.setItem("unrelated", "keep")
    resetGraphPreferences()
    expect(localStorage.getItem(GRAPH_PREFERENCES_KEY)).toBeNull()
    expect(localStorage.getItem("unrelated")).toBe("keep")
  })
})
