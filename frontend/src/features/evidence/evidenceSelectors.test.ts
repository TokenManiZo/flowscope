import { describe, expect, it } from "vitest"
import type { EventRecord } from "@/lib/api/types"
import { defaultEvidenceFilters, visibleEvidence } from "./evidenceSelectors"

const record = (eventId: string, overrides: Partial<EventRecord> = {}): EventRecord => ({
  eventId, method: "GET", path: "/api/orders", idn: "user-a", source: "human",
  trafficDisposition: "INCLUDE", trafficClass: "API", clusterId: "repeated",
  ...overrides,
} as EventRecord)

describe("observation record search", () => {
  const records = [record("event-96"), record("other-id")]
  const search = { ordinals: { "event-96": 12, "other-id": 96 }, accountLabels: { "user-a": "USER A" } }

  it.each(["96", "#96"])("finds the displayed number %s inside a collapsed repeat group", query => {
    expect(visibleEvidence(records, { ...defaultEvidenceFilters(), query }, search).map(item => item.eventId)).toEqual(["other-id"])
  })

  it("does not confuse an internal event id or a partial number with the displayed ordinal", () => {
    expect(visibleEvidence(records, { ...defaultEvidenceFilters(), query: "9" }, search)).toEqual([])
    expect(visibleEvidence(records, { ...defaultEvidenceFilters(), query: "event-96" }, search)).toEqual([])
  })

  it("keeps source and disposition restrictions when searching an exact number", () => {
    const hidden = record("other-id", { trafficDisposition: "EXCLUDE" })
    expect(visibleEvidence([hidden], { ...defaultEvidenceFilters(), query: "#96" }, search)).toEqual([])
    const filters = defaultEvidenceFilters()
    expect(visibleEvidence(records, { ...filters, sources: { ...filters.sources, human: false }, query: "96" }, search)).toEqual([])
  })

  it("searches the registered account label and preserves method and path search", () => {
    for (const query of ["USER A", "GET", "orders"]) {
      expect(visibleEvidence(records, { ...defaultEvidenceFilters(), query }, search)).toHaveLength(1)
    }
  })
})
