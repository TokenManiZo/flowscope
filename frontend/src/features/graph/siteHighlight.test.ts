import { describe, expect, it } from "vitest"

import type { Cell, EventRecord, Source } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { graphContents, projectHierarchy } from "./graphHierarchy"
import { EMPTY_HIGHLIGHT, projectSiteHighlight, type GraphHighlight } from "./graphHighlight"
import { initialGraphNavigation } from "./graphWorkspace"

const sources: Source[] = ["human", "scanner", "llm", "unknown"]
const cell = (op: string, idn: string, perSource: Cell["perSource"], evidenceIds: string[]): Cell => ({ op, idn, resource: null, perSource, evidenceIds, reasons: {}, overall: "allow", conflict: false, missedSources: [] })
const event = (eventId: string, source: Source, idn: string, status: number, clusterEvidenceIds?: string[], op = "https://one.test GET /api/orders"): EventRecord => ({ eventId, source, idn, status, clusterEvidenceIds, op, method: "GET", path: "/api/orders", resource: null, fp: "", role: "USER", timestamp: 1, sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "DISCOVERY", executionTrust: "OBSERVED", runId: "run", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "LITERAL", pathTemplateReasons: [], clusterId: eventId, repeatCount: 1, firstSeen: 1, lastSeen: 1, objects: [], verdict: "untested" })
const cells = [
  cell("https://one.test GET /api/orders", "alice", { human: "allow", scanner: "deny" }, ["order-a", "order-scan"]),
  cell("https://one.test GET /api/orders", "bob", { human: "deny" }, ["order-b"]),
  cell("https://one.test GET /api/products", "bob", { scanner: "deny" }, ["product"]),
  cell("https://two.test GET /api/orders", "carol", { llm: "allow" }, ["cluster-member"]),
  cell("https://two.test GET /api/archived", "carol", { human: "allow" }, ["evicted"]),
]
const events = [event("order-a", "human", "alice", 200), event("order-scan", "scanner", "alice", 500), event("order-b", "human", "bob", 403), event("product", "scanner", "bob", 403, undefined, cells[2].op), event("cluster-representative", "llm", "carol", 302, ["cluster-member"], cells[3].op)]
const graph = projectHierarchy(targetSnapshot({ cells, events }), { source: sources, identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }, initialGraphNavigation)
const matchingGroups = (highlight: GraphHighlight) => {
  const matches = projectSiteHighlight(graph, events, highlight)!
  return graph.edges.filter(edge => matches.has(edge.id)).map(edge => edge.targetId)
}
const groupId = (service: string, name: string) => `api-group:${JSON.stringify([service, name])}`

describe("Site Overview filters", () => {
  it("disables dimming when all filters are cleared", () => {
    expect(projectSiteHighlight(graph, events, EMPTY_HIGHLIGHT)).toBeNull()
  })

  it("matches source or identity from each group's own cells without depending on retained events", () => {
    expect(matchingGroups({ ...EMPTY_HIGHLIGHT, sources: ["human", "llm"] })).toEqual([groupId("https://one.test", "orders"), groupId("https://two.test", "archived"), groupId("https://two.test", "orders")])
    expect(matchingGroups({ ...EMPTY_HIGHLIGHT, identities: ["alice", "bob"] })).toEqual([groupId("https://one.test", "orders"), groupId("https://one.test", "products")])
  })

  it("requires identity and source to occur in the same cell", () => {
    expect(matchingGroups({ ...EMPTY_HIGHLIGHT, identities: ["bob"], sources: ["scanner"] })).toEqual([groupId("https://one.test", "products")])
  })

  it("requires status, identity, and source to match the same event", () => {
    expect(matchingGroups({ sources: ["human"], identities: ["alice"], statuses: [403, 500] })).toEqual([])
    expect(matchingGroups({ sources: ["scanner"], identities: ["alice"], statuses: [500] })).toEqual([groupId("https://one.test", "orders")])
  })

  it("matches selected statuses with OR and resolves clustered evidence", () => {
    expect(matchingGroups({ ...EMPTY_HIGHLIGHT, statuses: [200, 302] })).toEqual([groupId("https://one.test", "orders"), groupId("https://two.test", "orders")])
  })

  it("keeps an empty match set active and does not invent status for evicted evidence", () => {
    expect(projectSiteHighlight(graph, events, { ...EMPTY_HIGHLIGHT, identities: ["nobody"] })?.size).toBe(0)
    expect(matchingGroups({ sources: ["human"], identities: ["carol"], statuses: [200] })).toEqual([])
  })

  it("preserves structural edge colors and the unfiltered projection", () => {
    const before = JSON.stringify(graph)
    const matches = projectSiteHighlight(graph, events, { ...EMPTY_HIGHLIGHT, statuses: [200] })!
    for (const [id, color] of matches) expect(color).toBe(graph.edges.find(edge => edge.id === id)?.color)
    expect(JSON.stringify(graph)).toBe(before)
  })

  it("matches response-backed functions without cells using the same request for every axis", () => {
    const observed = [event("observed-a", "human", "alice", 200), event("observed-b", "scanner", "bob", 403)]
    const data = targetSnapshot({ events: observed.map(item => ({ ...item, trafficClass: "UNKNOWN", trafficDisposition: "REVIEW" })) })
    const filters = { source: sources, identity: [], view: "source" as const, includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }
    const site = projectHierarchy(data, filters, initialGraphNavigation)
    const contents = graphContents(data, filters)
    const matches = (highlight: GraphHighlight) => projectSiteHighlight(site, data.events, highlight, contents.observedEvents)!
    expect(site.groups[0].cells).toHaveLength(0)
    expect(matches({ sources: ["human"], identities: ["alice"], statuses: [200] }).size).toBe(1)
    expect(matches({ sources: ["human"], identities: ["alice"], statuses: [403] }).size).toBe(0)
    expect(matches({ sources: ["scanner"], identities: ["alice"], statuses: [] }).size).toBe(0)
  })

  it("matches only enabled support evidence and never borrows excluded or other-service requests", () => {
    const support = { ...event("poll", "human", "dora", 201), trafficClass: "POLLING", trafficDisposition: "EXCLUDE" }
    const excluded = { ...event("excluded", "human", "hidden", 202), classificationOverride: true, trafficDisposition: "EXCLUDE", classificationReasons: ["USER_EXCLUDE"] }
    const elsewhere = event("elsewhere", "human", "elsewhere", 203, undefined, "https://elsewhere.test GET /api/orders")
    const data = targetSnapshot({ cells, events: [...events, support, excluded, elsewhere] })
    for (const includeSupportTraffic of [false, true]) {
      const filters = { source: sources, identity: [], view: "source" as const, includeRouteCandidates: false, includeSupportTraffic, expanded: false }
      const site = projectHierarchy(data, filters, initialGraphNavigation)
      const contents = graphContents(data, filters)
      const matches = (highlight: GraphHighlight) => projectSiteHighlight(site, data.events, highlight, [...contents.observedEvents, ...contents.supportEvents])!
      expect(matches({ sources: ["human"], identities: ["dora"], statuses: [201] }).size).toBe(includeSupportTraffic ? 1 : 0)
      expect(matches({ ...EMPTY_HIGHLIGHT, identities: ["hidden"] }).size).toBe(0)
      const matching = matches({ ...EMPTY_HIGHLIGHT, identities: ["elsewhere"] })
      expect(site.edges.filter(edge => matching.has(edge.id)).map(edge => edge.targetId)).toEqual([groupId("https://elsewhere.test", "orders")])
    }
  })
})
