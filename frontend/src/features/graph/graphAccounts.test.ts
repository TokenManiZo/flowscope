import { expect, it } from "vitest"
import type { Cell, EventRecord } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { graphAccountLabel } from "./graphAccounts"
import { graphCellKey, type GraphFilters } from "./graphProjection"
import { navigateHierarchy, projectHierarchy, type GraphNavigation } from "./graphHierarchy"
import { buildGraphSearchIndex } from "./graphSearch"

const op = "https://shop.example.test:443 GET /api/items"
const event = (overrides: Partial<EventRecord> = {}): EventRecord => ({ eventId: "e1", idn: "anon", fp: "ck:cookie", authState: "ANONYMOUS", source: "human", op, method: "GET", path: "/api/items", status: 200, phase: "EXPLORATION", executionTrust: "OBSERVED", trafficClass: "API", trafficDisposition: "INCLUDE", classificationReasons: [], runId: "run1", ...overrides } as EventRecord)
const cell: Cell = { idn: "anon", op, resource: null, overall: "untested", perSource: { human: "untested" }, reasons: {}, conflict: false, missedSources: [], evidenceIds: ["e1"] }
const filters: GraphFilters = { source: ["human", "scanner", "llm"], identity: [], view: "source", expanded: false, includeRouteCandidates: false, includeSupportTraffic: false }
const site: GraphNavigation = { level: "site", groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }
const groupOf = (snapshot: ReturnType<typeof targetSnapshot>) => navigateHierarchy(site, "group", projectHierarchy(snapshot, filters, site).groups[0].id)

it.each((["human", "scanner", "llm"] as const).flatMap(source => ["anon", "user-a"].map(card => ({ source, card }))))(
  "$source displays the server selected $card and its decisions despite cookies", ({ source, card }) => {
  const raw = targetSnapshot({
    accounts: [{ id: "user-a", label: "USER A", role: "USER", target: "", color: "", authArtifactCount: 0 }],
    events: [event({ source, idn: card, collectionAccountId: card, authState: card === "anon" ? "ANONYMOUS" : "ACCOUNT_BOUND" })],
    cells: [{ ...cell, idn: card, perSource: { [source]: "untested" } }],
  })
  const graph = raw
  const projection = projectHierarchy(graph, filters, groupOf(graph))
  const identity = projection.nodes.find(node => node.kind === "identity")!
  expect(identity.label).toBe(card === "anon" ? "비로그인" : "USER A")
  expect(identity.selection.identity).toBe(card)
  expect(identity.selection.cellKeys).toEqual([graphCellKey(raw.cells[0])])
  expect(graph.cells[0].overall).toBe(cell.overall)
  expect(graph.events[0]).toMatchObject({ fp: "ck:cookie", authState: card === "anon" ? "ANONYMOUS" : "ACCOUNT_BOUND" })
  expect(raw.events[0].idn).toBe(card)
  expect(raw.cells[0].idn).toBe(card)
  expect(buildGraphSearchIndex(graph, filters).entries.find(entry => entry.kind === "identity")?.title).toBe(card === "anon" ? "비로그인" : "USER A")
})

it("keeps same-named cards and their server decisions separate", () => {
  const graph = targetSnapshot({
    accounts: ["a", "b"].map(id => ({ id, label: "내 계정", role: "USER", target: "", color: "", authArtifactCount: 0 })),
    events: [event({ idn: "a" }), event({ eventId: "e2", idn: "b", source: "scanner" })],
    cells: [
      { ...cell, idn: "a", perSource: { human: "allow" }, overall: "allow" },
      { ...cell, idn: "b", evidenceIds: ["e2"], perSource: { scanner: "deny" }, overall: "deny" },
    ],
  })
  const identities = projectHierarchy(graph, filters, groupOf(graph)).nodes.filter(node => node.kind === "identity")
  expect(identities.map(node => node.id).sort()).toEqual(["identity:a", "identity:anon", "identity:b"])
  expect(identities.filter(node => node.id !== "identity:anon").map(node => node.label)).toEqual(["내 계정", "내 계정"])
  expect(identities.find(node => node.id === "identity:a")?.selection.evidenceIds).toEqual(["e1"])
  expect(identities.find(node => node.id === "identity:b")?.selection.evidenceIds).toEqual(["e2"])
  expect(graphCellKey(graph.cells[0])).not.toBe(graphCellKey(graph.cells[1]))
  expect(graphAccountLabel(graph, "a")).toBe("내 계정")
})

it.each(["group", "operation"] as const)("keeps unvisited accounts visible in %s without inventing evidence or edges", level => {
 const snapshot = targetSnapshot({ accounts: ["user-a", "user-b"].map(id => ({ id, label: id, role: "USER", target: "", color: "", authArtifactCount: 0 })), events: [event()], cells: [cell] })
 const navigation = { ...groupOf(snapshot), level, operation: level === "operation" ? op : "" }
 const graph = projectHierarchy(snapshot, filters, navigation)
 expect(graph.identities.map(node => node.id).sort()).toEqual(["identity:anon", "identity:user-a", "identity:user-b"])
 for (const id of ["identity:user-a", "identity:user-b"]) {
  const node = graph.identities.find(node => node.id === id)!
  expect(node.selection.evidenceIds).toEqual([])
  expect(node.selection.cells).toEqual([])
  expect(node.verdict).toBe("unknown")
  expect(graph.edges.some(edge => edge.sourceId === id || edge.targetId === id)).toBe(false)
 }
 expect(projectHierarchy(snapshot, filters, site).identities).toEqual([])
})
