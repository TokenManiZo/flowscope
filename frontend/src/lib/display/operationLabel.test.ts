import { describe, expect, it } from "vitest"

import { evidenceOrdinalLabel, evidenceOrdinalLabels, observedTimeLabel, withEvidenceOrdinals, withoutUnnumberedEvidence } from "./operationLabel"

describe("evidence labels", () => {
  it("shows the server ordinal and falls back to the raw id", () => {
    const ordinals = { "ev-a": 3 }
    expect(evidenceOrdinalLabel(ordinals, "ev-a")).toBe("#3")
    expect(evidenceOrdinalLabel(ordinals, "ev-missing")).toBe("ev-missing")
    expect(withEvidenceOrdinals("ev-d3fe5b9b48d4a6b1, ev-4a3846a26981c4cc", { "ev-d3fe5b9b48d4a6b1": 4 })).toBe("#4, ev-4a3846a26981c4cc")
  })

  it("lists only numbered records so deleted ones are neither shown nor counted", () => {
    expect(evidenceOrdinalLabels({ "ev-a": 3, "ev-b": 1 }, ["ev-a", "ev-gone", "ev-b", "ev-a"])).toEqual(["#3", "#1"])
    expect(evidenceOrdinalLabels(undefined, ["ev-a"])).toEqual([])
  })

  it("drops a record ID that has no number yet from a progress line", () => {
    expect(withoutUnnumberedEvidence(withEvidenceOrdinals("user-a · HTTP 200 · ev-d3fe5b9b48d4a6b1", { "ev-d3fe5b9b48d4a6b1": 4 }))).toBe("user-a · HTTP 200 · #4")
    expect(withoutUnnumberedEvidence("user-a · HTTP 200 · ev-4a3846a26981c4cc")).toBe("user-a · HTTP 200")
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
