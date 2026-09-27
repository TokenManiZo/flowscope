import { describe, expect, it } from "vitest"

import { evidenceFullLabel, evidenceOrdinalLabel, observedTimeLabel } from "./operationLabel"

describe("evidence labels", () => {
  it("shows the server ordinal and keeps the raw id for copy and trace-back", () => {
    const ordinals = { "ev-a": 3 }
    expect(evidenceOrdinalLabel(ordinals, "ev-a")).toBe("#3")
    expect(evidenceFullLabel(ordinals, "ev-a")).toBe("#3 · ev-a")
    expect(evidenceFullLabel(ordinals, "ev-missing")).toBe("ev-missing")
    expect(evidenceFullLabel(undefined, "ev-a")).toBe("ev-a")
  })
})

describe("observedTimeLabel", () => {
  const at = Date.UTC(2026, 7, 24, 3, 0, 0)

  it("formats epoch milliseconds instead of printing the raw number", () => {
    const label = observedTimeLabel(at, at)
    expect(label).toContain("2026")
    expect(label).not.toContain(String(at))
    expect(label).not.toContain("~")
  })

  it("shows a range only for repeated observations", () => {
    expect(observedTimeLabel(at, at + 60_000)).toMatch(/^.+ ~ .+$/)
  })

  it("marks unreadable import timestamps instead of showing 1970", () => {
    expect(observedTimeLabel(0, 0)).toBe("시각 미상")
  })
})
