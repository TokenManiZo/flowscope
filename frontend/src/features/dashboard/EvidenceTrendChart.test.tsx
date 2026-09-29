import { expect, it } from "vitest"
import type { EventRecord } from "@/lib/api/types"
import { buildEvidenceTrend } from "./EvidenceTrendChart"

function event(eventId: string, timestamp: number, source: "human" | "scanner" | "llm"): EventRecord {
  return {
    eventId, method: "GET", path: `/${eventId}`, status: 200, fp: "fp", idn: "user", role: "USER", source,
    op: `GET /${eventId}`, resource: null, timestamp, sourceDetail: source === "human" ? "BROWSER" : "ZAP",
    orchestrator: source === "human" ? "HUMAN" : source === "scanner" ? "SCANNER" : "LLM", tool: source === "human" ? "BROWSER" : source === "scanner" ? "ZAP" : "MCP",
    phase: "EXPLORATION", executionTrust: "OBSERVED", runId: "run", authState: "AUTHENTICATED",
    trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false,
    classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: eventId,
    repeatCount: 1, firstSeen: timestamp, lastSeen: timestamp, clusterEvidenceIds: [eventId], objects: [], verdict: "allow",
  }
}

it("keeps tightly clustered early 관측 기록 early and a late event late on the elapsed-time domain", () => {
  const points = buildEvidenceTrend([
    event("h-1", 1, "human"), event("h-2", 2, "human"), event("s-1", 3, "scanner"), event("l-1", 4, "llm"), event("h-3", 1_000_000, "human"),
  ])

  expect(points[0]).toMatchObject({ human: 2, scanner: 1, llm: 1, timestamp: 1 })
  expect(points.at(-2)).toMatchObject({ human: 2, scanner: 1, llm: 1 })
  expect(points.at(-1)).toMatchObject({ human: 3, scanner: 1, llm: 1, timestamp: 1_000_000 })
})

it("keeps no-event and equal-timestamp series deterministic while preserving cumulative totals", () => {
  const empty = buildEvidenceTrend([])
  expect(empty).toHaveLength(16)
  expect(empty.every((point) => point.human === 0 && point.scanner === 0 && point.llm === 0 && point.timestamp === 0)).toBe(true)

  const single = buildEvidenceTrend([event("h-1", 100, "human")])
  expect(single.every((point) => point.human === 1 && point.scanner === 0 && point.llm === 0 && point.timestamp === 100)).toBe(true)

  const equal = buildEvidenceTrend([
    event("h-1", 100, "human"), event("s-1", 100, "scanner"), event("h-2", 100, "human"),
  ])
  expect(equal.every((point) => point.timestamp === 100)).toBe(true)
  expect(equal[0]).toMatchObject({ human: 2, scanner: 1, timestamp: 100 })
  expect(equal.at(-1)).toMatchObject({ human: 2, scanner: 1, timestamp: 100 })
})
