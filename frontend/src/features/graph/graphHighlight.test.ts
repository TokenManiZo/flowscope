import { describe, expect, it } from "vitest"

import type { EventRecord, Source } from "@/lib/api/types"
import { EMPTY_HIGHLIGHT, HIGHLIGHT_IDENTITY_COLOR, HIGHLIGHT_SOURCE_COLOR, STATUS_CLASS_COLOR, edgeStatusCounts, indexEventsByEvidence, nodeStatusCodes, projectHighlight, statusClass, statusGroups, statusHighlightColors } from "./graphHighlight"

function event(eventId: string, source: Source, idn: string, status: number, clusterEvidenceIds?: string[]): EventRecord {
  return { eventId, source, idn, status, clusterEvidenceIds } as unknown as EventRecord
}
function edge(id: string, source: Source | null, identity: string | null, evidenceIds: string[]) {
  return { id, source, selection: { identity, evidenceIds } }
}

const events = [
  event("e1", "human", "user-1", 200),
  event("e2", "human", "user-2", 200),
  event("e3", "human", "user-2", 403),
  event("e4", "scanner", "anon", 401),
  event("e5", "llm", "user-2", 302),
]
const edges = [
  edge("u1-human", "human", "user-1", ["e1"]),
  // 셀 Evidence에는 다른 출처(e5·LLM)도 섞여 있다. 엣지 출처로 다시 걸러야 한다.
  edge("u2-human", "human", "user-2", ["e2", "e3", "e5"]),
  edge("anon-scanner", "scanner", "anon", ["e4"]),
  edge("u2-llm", "llm", "user-2", ["e2", "e3", "e5"]),
  edge("structural", null, null, []),
]

describe("graph highlight", () => {
  it("keeps every edge neutral when nothing is selected", () => {
    expect(projectHighlight(edges, events, EMPTY_HIGHLIGHT)).toBeNull()
  })

  it("matches OR within an axis and AND across axes", () => {
    const either = projectHighlight(edges, events, { ...EMPTY_HIGHLIGHT, identities: ["user-1", "anon"] })!
    expect([...either.keys()].sort()).toEqual(["anon-scanner", "u1-human"])
    const both = projectHighlight(edges, events, { ...EMPTY_HIGHLIGHT, sources: ["human"], identities: ["user-2"] })!
    expect([...both.keys()]).toEqual(["u2-human"])
  })

  it("never highlights structural edges that carry no source", () => {
    const all = projectHighlight(edges, events, { ...EMPTY_HIGHLIGHT, sources: ["human", "scanner", "llm"] })!
    expect(all.has("structural")).toBe(false)
  })

  it("colours by the selected status first, then by source, then with the identity accent", () => {
    expect(projectHighlight(edges, events, { ...EMPTY_HIGHLIGHT, statuses: [403] })!.get("u2-human")).toBe(STATUS_CLASS_COLOR["4xx"])
    expect(projectHighlight(edges, events, { ...EMPTY_HIGHLIGHT, sources: ["scanner"] })!.get("anon-scanner")).toBe(HIGHLIGHT_SOURCE_COLOR.scanner)
    expect(projectHighlight(edges, events, { ...EMPTY_HIGHLIGHT, identities: ["user-1"] })!.get("u1-human")).toBe(HIGHLIGHT_IDENTITY_COLOR)
  })

  it("reads status codes only from the edge's own source and identity", () => {
    const counts = edgeStatusCounts(edges[1], indexEventsByEvidence(events))
    expect([...counts].sort()).toEqual([[200, 1], [403, 1]])
    // 3xx도 강조 대상이다. LLM 엣지는 302를, HUMAN 엣지는 302를 갖지 않는다.
    const redirect = projectHighlight(edges, events, { ...EMPTY_HIGHLIGHT, statuses: [302] })!
    expect([...redirect.keys()]).toEqual(["u2-llm"])
    expect(redirect.get("u2-llm")).toBe(STATUS_CLASS_COLOR["3xx"])
  })

  it("finds events through clustered evidence IDs without double counting", () => {
    const clustered = [event("rep", "human", "user-1", 200, ["rep", "member"])]
    const counts = edgeStatusCounts(edge("x", "human", "user-1", ["rep", "member"]), indexEventsByEvidence(clustered))
    expect(counts.get(200)).toBe(1)
  })

  it("collects each API node's observed status codes across sources, without counts", () => {
    const nodes = [
      { id: "operation:orders", kind: "operation", selection: { evidenceIds: ["e2", "e3", "e5", "e2"] } },
      { id: "identity:user-2", kind: "identity", selection: { evidenceIds: ["e2"] } },
      { id: "operation:empty", kind: "operation", selection: { evidenceIds: ["missing"] } },
    ]
    const codes = nodeStatusCodes(nodes, events)
    expect(codes.get("operation:orders")).toEqual([200, 302, 403])
    expect(codes.has("identity:user-2")).toBe(false)
    expect(codes.has("operation:empty")).toBe(false)
  })

  it("colours only the chosen codes for card badges", () => {
    expect([...statusHighlightColors({ ...EMPTY_HIGHLIGHT, statuses: [302, 500] })]).toEqual([[302, STATUS_CLASS_COLOR["3xx"]], [500, STATUS_CLASS_COLOR["5xx"]]])
    expect(statusHighlightColors(EMPTY_HIGHLIGHT).size).toBe(0)
  })

  it("always lists only 2xx to 5xx, leaving other codes out of the rail", () => {
    expect(statusGroups([]).map((group) => group.cls)).toEqual(["2xx", "3xx", "4xx", "5xx"])
    const groups = statusGroups([...events, event("e6", "human", "user-1", 0)])
    expect(groups.map((group) => group.cls)).toEqual(["2xx", "3xx", "4xx", "5xx"])
    expect(groups.find((group) => group.cls === "4xx")).toEqual({ cls: "4xx", codes: [{ status: 401, count: 1 }, { status: 403, count: 1 }], total: 2 })
    expect(statusClass(302)).toBe("3xx")
  })
})
