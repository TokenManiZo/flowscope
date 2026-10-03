import { describe, expect, it } from "vitest"
import { accountObservations } from "./accountObservations"
import { snapshotFixture } from "@/test/fixtures"
import type { EventRecord } from "@/lib/api/types"

const event = (overrides: Partial<EventRecord>): EventRecord => ({ ...snapshotFixture.events[0], idn: "a", status: 200, source: "human", timestamp: 10, ...overrides })
describe("stored account responses", () => {
  it("prefers lane account over observed identity and preserves the traffic generator", () => {
    const totals = accountObservations([event({ laneAccountId: "a", idn: "anon", source: "scanner", orchestrator: "LLM", repeatCount: 20 }), event({ laneAccountId: "a", idn: "b", source: "llm", status: 401, timestamp: 20 })], ["a", "b"])
    expect(totals.get("a")).toEqual({ counts: { human: 0, scanner: 1, llm: 1 }, last: { human: 0, scanner: 10, llm: 20 } })
    expect(totals.get("b")?.counts).toEqual({ human: 0, scanner: 0, llm: 0 })
  })
  it("uses registered legacy identities without guessing unknown lanes or sources", () => {
    const totals = accountObservations([event({ repeatCount: 40 }), event({ laneAccountId: "missing" }), event({ idn: "unregistered" }), event({ source: "unknown" }), event({ status: 0 }), event({ status: NaN })], ["a"])
    expect(totals.get("a")?.counts).toEqual({ human: 1, scanner: 0, llm: 0 })
  })
})
