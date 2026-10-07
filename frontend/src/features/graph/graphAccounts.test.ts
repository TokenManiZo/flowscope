import { expect, it } from "vitest"
import type { Cell, EventRecord } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { collectionGraphSnapshot, graphAccountLabel } from "./graphAccounts"
import { graphCellKey, type GraphFilters } from "./graphProjection"
import { navigateHierarchy, projectHierarchy, type GraphNavigation } from "./graphHierarchy"
import { buildGraphSearchIndex } from "./graphSearch"

const op = "https://shop.example.test:443 GET /api/items"
const event = (overrides: Partial<EventRecord> = {}): EventRecord => ({ eventId: "e1", idn: "unresolved-cookie", fp: "ck:cookie", authState: "UNRESOLVED", source: "human", op, method: "GET", path: "/api/items", status: 200, phase: "EXPLORATION", executionTrust: "OBSERVED", trafficClass: "API", trafficDisposition: "INCLUDE", classificationReasons: [], runId: "run1", ...overrides } as EventRecord)
const cell: Cell = { idn: "unresolved-cookie", op, resource: null, overall: "untested", perSource: { human: "untested" }, reasons: {}, conflict: false, missedSources: [], evidenceIds: ["e1"] }
const filters: GraphFilters = { source: ["human", "scanner", "llm"], identity: [], view: "source", expanded: false, includeRouteCandidates: false, includeSupportTraffic: false }
const site: GraphNavigation = { level: "site", groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }
const groupOf = (snapshot: ReturnType<typeof targetSnapshot>) => navigateHierarchy(site, "group", projectHierarchy(snapshot, filters, site).groups[0].id)

it.each((["human", "scanner", "llm"] as const).flatMap(source => ["anon", "user-a"].map(card => ({ source, card }))))(
  "$source displays selected $card despite cookies without changing authentication or decisions", ({ source, card }) => {
  const raw = targetSnapshot({
    accounts: [{ id: "user-a", label: "USER A", role: "USER", target: "", color: "", authArtifactCount: 0 }],
    events: [event({ source, collectionAccountId: card })],
    cells: [{ ...cell, perSource: { [source]: "untested" } }],
  })
  const graph = collectionGraphSnapshot(raw)
  const projection = projectHierarchy(graph, filters, groupOf(graph))
  const identity = projection.nodes.find(node => node.kind === "identity")!
  expect(identity.label).toBe(card === "anon" ? "비로그인" : "USER A")
  expect(identity.selection.identity).toBe(card)
  expect(identity.selection.cellKeys).toEqual([graphCellKey(cell)])
  expect(graph.cells[0].overall).toBe(cell.overall)
  expect(graph.events[0]).toMatchObject({ fp: "ck:cookie", authState: "UNRESOLVED" })
  expect(raw.events[0].idn).toBe("unresolved-cookie")
  expect(raw.cells[0].idn).toBe(cell.idn)
  expect(buildGraphSearchIndex(graph, filters).entries.find(entry => entry.kind === "identity")?.title).toBe(card === "anon" ? "비로그인" : "USER A")
})

it("keeps same-named cards separate and selects only their evidence when one server cell spans cards", () => {
  const raw = targetSnapshot({
    accounts: ["a", "b"].map(id => ({ id, label: "내 계정", role: "USER", target: "", color: "", authArtifactCount: 0 })),
    events: [event({ collectionAccountId: "a" }), event({ eventId: "e2", source: "scanner", collectionAccountId: "b" })],
    cells: [{ ...cell, evidenceIds: ["e1", "e2"], perSource: { human: "allow", scanner: "deny" }, overall: "undecided" }],
  })
  const graph = collectionGraphSnapshot(raw)
  const identities = projectHierarchy(graph, filters, groupOf(graph)).nodes.filter(node => node.kind === "identity")
  expect(identities.map(node => node.id).sort()).toEqual(["identity:a", "identity:b"])
  expect(identities.map(node => node.label)).toEqual(["내 계정", "내 계정"])
  expect(identities.find(node => node.id === "identity:a")?.selection.evidenceIds).toEqual(["e1"])
  expect(identities.find(node => node.id === "identity:b")?.selection.evidenceIds).toEqual(["e2"])
  expect(graph.cells.map(item => item.perSource)).toEqual([{ human: "allow" }, { scanner: "deny" }])
  expect(graph.cells.every(item => graphCellKey(item) === graphCellKey(raw.cells[0]))).toBe(true)
  expect(graphAccountLabel(raw, "a")).toBe("내 계정")
})

it("uses existing registered lane metadata but never guesses anonymous provenance from a cookie or run name", () => {
  const raw = targetSnapshot({ events: [event({ laneAccountId: "a" }), event({ eventId: "e2", runId: "human-anon" })], cells: [cell] })
  const graph = collectionGraphSnapshot(raw)
  expect(graph.events.map(item => item.idn)).toEqual(["a", "unresolved-cookie"])
  expect(graph.cells[0].idn).toBe("a")
  expect(collectionGraphSnapshot(targetSnapshot({ cells: [cell] })).cells[0]).toBe(cell)
})
