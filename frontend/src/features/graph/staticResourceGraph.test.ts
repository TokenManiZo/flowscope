import { describe, expect, it } from "vitest"
import type { EventRecord, Snapshot } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { graphContents, projectHierarchy, type GraphNavigation } from "./graphHierarchy"
import { staticResourceEntries, staticResourceExtension } from "./staticResourceGraph"
import type { GraphFilters } from "./graphProjection"
import { buildGraphSearchIndex, searchDestination } from "./graphSearch"
import { relationshipNodeCard } from "./relationshipNodeCard"
import { graphFocusStates } from "./CytoscapeGraph"
import { EMPTY_HIGHLIGHT, projectSiteHighlight } from "./graphHighlight"

const service = "https://files.test:443"
const broad: GraphFilters = { source: ["human", "scanner", "llm"], identity: [], view: "source", includeRouteCandidates: false, includeSupportTraffic: true, expanded: false }
const site: GraphNavigation = { level: "site", groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }
const event = (id: string, path: string, extra: Partial<EventRecord> = {}): EventRecord => ({
  eventId: id, path, op: `${service} GET /assets/{id}/{id}`, method: "GET", status: 200, idn: "user-a", role: "USER",
  source: "human", phase: "DISCOVERY", executionTrust: "OBSERVED", sourceDetail: "BROWSER", timestamp: 1,
  trafficClass: "STATIC_ASSET", trafficDisposition: "EXCLUDE", classificationReasons: ["STATIC_RESOURCE_EXTENSION"],
  classificationOverride: false, coverageEligible: false, resource: "legacy:1", objects: [], clusterEvidenceIds: [id],
  fp: "f", orchestrator: "HUMAN", tool: "BROWSER", runId: "r", authState: "AUTH", pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [],
  clusterId: id, repeatCount: 1, firstSeen: 1, lastSeen: 1, verdict: "untested", ...extra,
})
const data = () => targetSnapshot({ displayObjects: [], events: [
  event("gif", "/assets/202609/a123.gif"), event("png", "/assets/202609/b456.png"), event("css", "/assets/202610/site.css"),
] })
const navigation = (snapshot: Snapshot) => ({ ...site, level: "group" as const, groupId: projectHierarchy(snapshot, broad, site).groups[0].id })

describe("static resource observations", () => {
  it("opens both summaries into API paths with folded resource lists before exposing any objects", () => {
    const snapshot = data(), nav = navigation(snapshot), before = JSON.stringify(snapshot)
    const closed = projectHierarchy(snapshot, broad, nav)
    const family = closed.nodes.find(node => node.kind === "operation-group")!
    const summary = closed.nodes.find(node => node.kind === "object-group")!
    expect(closed.operations).toHaveLength(0)
    expect(closed.resources).toHaveLength(0)
    expect(summary.expandGroupId).toBe(family.id)
    expect(family.objectGroup?.members).toHaveLength(2)
    expect(summary.objectGroup?.members).toHaveLength(3)
    const opened = { ...broad, expandedObjectGroups: [summary.expandGroupId!] }
    const paths = projectHierarchy(snapshot, opened, nav)
    expect(paths.operations.map(node => node.label)).toEqual([`${service} GET /assets/202609/{file}`, `${service} GET /assets/202610/{file}`])
    expect(paths.nodes.filter(node => node.kind === "object-group")).toHaveLength(2)
    expect(paths.resources).toHaveLength(0)
    const group = paths.nodes.find(node => node.kind === "object-group" && node.objectGroup?.members.length === 2)!
    const children = projectHierarchy(snapshot, { ...opened, expandedObjectGroups: [...opened.expandedObjectGroups, group.id] }, nav)
    expect(children.resources.map(node => node.label)).toEqual([".gif", ".png"])
    expect(children.resources.flatMap(node => node.selection.evidenceIds).sort()).toEqual(["gif", "png"])
    for (const node of children.nodes.filter(node => node.staticResource)) {
      expect(node.selection.cells).toEqual([])
      expect(node.selection.cellKeys).toEqual([])
      expect(node.selection.resource).toBeNull()
      expect(node.verdict).toBe("unknown")
    }
    expect(relationshipNodeCard(group, paths).badge).toBe("STATIC RESOURCE")
    expect(JSON.stringify(snapshot)).toBe(before)
    const focus = graphFocusStates(children, group.id, group.id)
    for (const resource of children.resources) expect(focus.node(resource.id)).toBe("yes")
    const sibling = children.nodes.find(node => node.kind === "object-group" && node.id !== group.id)!
    expect(focus.node(sibling.id)).toBe("no")
  })

  it("never adds static entries to the core view, backend display objects or route candidates", () => {
    const snapshot = data(), core = { ...broad, includeSupportTraffic: false }
    expect(projectHierarchy(snapshot, core, site).groups).toEqual([])
    expect(buildGraphSearchIndex(snapshot, core).entries).toEqual([])
    expect(graphContents(snapshot, broad).observedEvents).toEqual([])
    expect(snapshot.cells).toEqual([])
    expect(snapshot.displayObjects).toEqual([])
    expect(snapshot.routeCandidates).toEqual([])
  })

  it("keeps each resource's evidence exact even when the backend repetition cluster spans multiple targets", () => {
    const snapshot = data()
    snapshot.events = snapshot.events.map(event => ({ ...event, clusterEvidenceIds: ["gif", "png", "css"] }))
    const entries = staticResourceEntries(snapshot, broad)
    const graph = projectHierarchy(snapshot, { ...broad, expandedObjectGroups: [`operation-group:${entries[0].familyId}`, `object-group:${entries[0].groupKey}`] }, navigation(snapshot))
    expect(graph.resources.map(node => node.selection.evidenceIds)).toEqual([["gif"], ["png"]])
    expect(graph.edges.filter(edge => graph.resources.some(node => node.id === edge.targetId)).map(edge => edge.selection.evidenceIds)).toEqual([["gif"], ["png"]])
  })

  it("honors source, identity and collection trust gates instead of admitting replay or supporting assets", () => {
    const snapshot = targetSnapshot({ events: [
      event("normal", "/images/a.gif"), event("anon", "/images/b.gif", { idn: "anon", source: "scanner", status: 403 }),
      event("setup", "/images/c.gif", { phase: "SESSION_SETUP" }), event("validation", "/images/d.gif", { phase: "VALIDATION" }),
      event("replay", "/images/e.gif", { phase: "AUTHORIZATION_REPLAY" }), event("manual", "/images/f.gif", { sourceDetail: "BURP_REPEATER" }),
      event("unknown", "/images/g.gif", { source: "unknown" }), event("runtime", "/images/h.gif", { executionTrust: "UNVERIFIED_RUNTIME" }),
      event("no-response", "/images/i.gif", { classificationReasons: ["NO_RESPONSE"] }),
      event("supporting", "/images/j.gif", { classificationReasons: ["SUPPORTING_CROSS_ORIGIN_ASSET"] }),
      event("excluded", "/images/k.gif", { classificationReasons: ["USER_EXCLUDE"] }),
    ] })
    expect(staticResourceEntries(snapshot, broad).map(entry => entry.event.eventId)).toEqual(["normal", "anon"])
    expect(staticResourceEntries(snapshot, { ...broad, source: ["scanner"], identity: ["anon"] }).map(entry => entry.event.eventId)).toEqual(["anon"])
  })

  it("uses backend classification for every static type and preserves methods, origins, query and slash distinctions", () => {
    const snapshot = targetSnapshot({ events: [
      event("woff", "/fonts/font.woff2"), event("wasm", "/assets/module.wasm"), event("map", "/assets/source.map"),
      event("compressed", "/assets/style.css.br"), event("opaque", "/assets/no-extension"),
      event("q1", "/assets/icon.gif?v=1"), event("q2", "/assets/icon.gif?v=2"),
      event("slash", "/assets/icon.gif/"), event("post", "/assets/icon.gif?v=1", { method: "POST" }),
      event("other", "/assets/icon.gif?v=1", { op: "https://other.test:443 GET /assets/icon.gif" }),
      event("api", "/reports/101.pdf", { trafficClass: "API" }),
    ] })
    const entries = staticResourceEntries(snapshot, broad)
    expect(entries).toHaveLength(10)
    expect(new Set(entries.map(entry => entry.objectKey)).size).toBe(10)
    expect(entries.find(entry => entry.event.eventId === "slash")?.apiPath).toBe("/assets/icon.gif/")
    expect(entries.find(entry => entry.event.eventId === "other")?.service).toBe("https://other.test:443")
    expect(entries.find(entry => entry.event.eventId === "wasm")?.apiId).toBe(entries.find(entry => entry.event.eventId === "compressed")?.apiId)
  })

  it("merges repeated observations but keeps individual files and caps the exposed objects at ten", () => {
    const snapshot = targetSnapshot({ displayObjects: [], events: [
      ...Array.from({ length: 15 }, (_, i) => event(`f${i}`, `/images/file${String(i).padStart(2, "0")}.gif`)),
      event("repeat", "/images/file00.gif", { idn: "user-b", source: "llm", status: 404 }),
    ] })
    const entries = staticResourceEntries(snapshot, broad), nav = navigation(snapshot)
    const open = { ...broad, expandedObjectGroups: [`operation-group:${entries[0].familyId}`, `object-group:${entries[0].groupKey}`] }
    const graph = projectHierarchy(snapshot, open, nav)
    expect(graph.resources.map(node => node.label)).toEqual(Array(10).fill(".gif"))
    expect(graph.resources[0].selection.evidenceIds).toEqual(["f0", "repeat"])
    expect(graph.nodes.find(node => node.kind === "object-group")?.objectGroup?.members).toHaveLength(15)
    const reversed = projectHierarchy({ ...snapshot, events: [...snapshot.events].reverse() }, open, nav)
    expect(reversed.resources.map(node => [node.id, node.label])).toEqual(graph.resources.map(node => [node.id, node.label]))
    expect(buildGraphSearchIndex(snapshot, broad).entries.filter(entry => entry.kind === "resource")).toHaveLength(10)
  })

  it("limits expanded path lists and resolves search beyond the limit using display coordinates", () => {
    const snapshot = targetSnapshot({ displayObjects: [], events: Array.from({ length: 30 }, (_, i) => event(`f${i}`, `/assets/${1000+i}/file.gif`)) })
    const entries = staticResourceEntries(snapshot, broad), nav = navigation(snapshot)
    const open = { ...broad, expandedObjectGroups: [`operation-group:${entries[0].familyId}`] }
    const graph = projectHierarchy(snapshot, open, nav)
    expect(graph.operations).toHaveLength(18)
    expect(graph.hiddenOperationCount).toBe(12)
    const index = buildGraphSearchIndex(snapshot, broad)
    const result = index.entries.find(entry => entry.kind === "resource" && entry.value === entries[29].objectKey)!
    const destination = searchDestination(result, site, null, false)
    expect(destination.navigation.level).toBe("group")
    expect(destination.reveal.staticApiId).toBe(entries[29].apiId)
    const searched = projectHierarchy(snapshot, { ...broad, expandedObjectGroups: destination.expand }, destination.navigation, destination.reveal)
    expect(searched.resources.map(node => node.id)).toContain(destination.nodeId)
    expect(searched.resources.find(node => node.id === destination.nodeId)?.selection.evidenceIds).toEqual(["f29"])
  })

  it("includes static records in site highlight without using unrelated records to satisfy the filter", () => {
    const snapshot = targetSnapshot({ events: [event("a", "/fonts/file.woff", { status: 403 }), event("b", "/images/icon.gif", { source: "scanner", status: 200 })] })
    const graph = projectHierarchy(snapshot, broad, site), contents = graphContents(snapshot, broad)
    const matched = projectSiteHighlight(graph, snapshot.events, { ...EMPTY_HIGHLIGHT, sources: ["human"], statuses: [403] }, contents)!
    expect(matched.size).toBe(1)
    expect(projectSiteHighlight(graph, snapshot.events, { ...EMPTY_HIGHLIGHT, sources: ["scanner"], statuses: [403] }, contents)?.size).toBe(0)
  })
})


it("labels static files by extension without reading query values or inventing an extension", () => {
  expect(staticResourceExtension("/images/a.JPG?v=.css")).toBe(".jpg")
  expect(staticResourceExtension("/a/file%2Egif#preview")).toBe(".gif")
  expect(staticResourceExtension("/js/app.js.gz?v=1")).toBe(".js.gz")
  expect(staticResourceExtension("/download?id=123.jpg")).toBe("확장자 없음")
  expect(staticResourceExtension("/images/a.gif/")).toBe("확장자 없음")
  expect(staticResourceExtension("/images/a%2Ffake.gif")).toBe("확장자 없음")
})
