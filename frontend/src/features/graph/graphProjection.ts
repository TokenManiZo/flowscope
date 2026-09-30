import type { Cell, EventRecord, RouteCandidate, Snapshot, Source, Verdict } from "@/lib/api/types"

export type GraphView = "source" | "authz"

export interface GraphFilters {
  source: readonly Source[]
  identity: readonly string[]
  view: GraphView
  reviewStates?: readonly (Verdict | "unknown")[]
  includeRouteCandidates: boolean
  includeSupportTraffic: boolean
  expanded: boolean
  /** 펼친 객체 묶음 노드 id("object-group:…"). 없으면 모든 묶음이 접힌 상태다. */
  expandedObjectGroups?: readonly string[]
}

export interface GraphSelection {
  operation: string | null
  resource: string | null
  identity: string | null
  source: Source | "unknown" | null
  evidenceIds: readonly string[]
  routeCandidate?: GraphRouteCandidateDetail
}

/** 계층 그래프 선택: 서버 권한 셀을 canonical key로 보존하고 Evidence ID를 합친다(판정은 다시 계산하지 않음). */
export interface GraphCellSelection extends GraphSelection {
  cellKeys: readonly string[]
  cells: readonly Cell[]
}

export function graphCellKey(cell: Pick<Cell, "idn" | "op" | "resource">): string {
  return JSON.stringify([cell.idn, cell.op, cell.resource ?? null])
}

export function graphCellSelection(cells: readonly Cell[], source: Source | null = null): GraphCellSelection {
  const common = (key: "idn" | "op" | "resource") => cells.length && cells.every((cell) => cell[key] === cells[0][key]) ? cells[0][key] : null
  return { operation: common("op"), resource: common("resource"), identity: common("idn"), source,
    cellKeys: [...new Set(cells.map(graphCellKey))], cells,
    evidenceIds: [...new Set(cells.flatMap((cell) => cell.evidenceIds))].sort(compareText) }
}

export interface GraphRouteCandidateDetail {
  id: string
  service: string
  method: string
  pathTemplate: string
  observed: boolean
  applicability: string
  provenanceTypes: readonly string[]
  provenanceEvidenceIds: readonly string[]
  provenance: RouteCandidate["provenance"]
  reviewReason: string
  priorityReasons: readonly string[]
}

export interface GraphNode {
  id: string
  kind: "identity" | "resource" | "operation" | "route-candidate"
  label: string
  wrappedLabel: string
  verdict: Verdict | "unknown"
  verdictText: string
  verdictColor: string
  selection: GraphSelection
}

export interface GraphEdge {
  id: string
  sourceId: string
  targetId: string
  relation: "identity-resource" | "resource-operation" | "identity-operation"
  source: Source | "unknown"
  sourceText: string
  line: "solid" | "dashed" | "dotted"
  color: string
  count: number
  countLabel: string
  selection: GraphSelection
}

export interface GraphRouteCandidate extends RouteCandidate {
  id: string
  label: string
  observedText: "관측됨" | "미관측 후보"
  selection: GraphSelection
}

export interface GraphProjection {
  view?: GraphView
  identities: readonly GraphNode[]
  resources: readonly GraphNode[]
  operations: readonly GraphNode[]
  routeCandidates: readonly GraphRouteCandidate[]
  listItems: readonly GraphNode[]
  edges: readonly GraphEdge[]
}

export function graphRouteCandidateId(candidate: Pick<RouteCandidate, "service" | "method" | "pathTemplate">) {
  return `route-candidate:${JSON.stringify([candidate.service, candidate.method, candidate.pathTemplate])}`
}

const PAGE_SIZE = 18
const supportClasses = new Set(["AUTH_SESSION", "NAVIGATION", "POLLING", "BACKGROUND"])

export const sourceStyles: Record<Source | "unknown", Pick<GraphEdge, "sourceText" | "line" | "color">> = {
  human: { sourceText: "HUMAN", line: "solid", color: "#2563eb" },
  scanner: { sourceText: "SCANNER", line: "dashed", color: "#dc2626" },
  llm: { sourceText: "LLM", line: "dotted", color: "#e4e4e7" },
  unknown: { sourceText: "UNKNOWN", line: "dotted", color: "#6b7280" },
}

export const verdictStyles: Record<Verdict | "unknown", { text: string; color: string }> = {
  allow: { text: "ALLOW", color: "#15803d" },
  deny: { text: "DENY", color: "#b91c1c" },
  suspicious: { text: "SUSPICIOUS", color: "#c2410c" },
  undecided: { text: "UNDECIDED", color: "#7c3aed" },
  untested: { text: "UNTESTED", color: "#6b7280" },
  unknown: { text: "UNKNOWN", color: "#6b7280" },
}

function normalizedSource(source: unknown): Source | "unknown" {
  const normalized = String(source ?? "").toLowerCase()
  return normalized === "human" || normalized === "scanner" || normalized === "llm" ? normalized : "unknown"
}

function compareText(left: string, right: string) { return left.localeCompare(right, "en") }

function evidenceIds(events: readonly EventRecord[]): readonly string[] {
  return [...new Set(events.flatMap((event) => event.clusterEvidenceIds?.length ? event.clusterEvidenceIds : [event.eventId]))].sort(compareText)
}

function eventSelection(events: readonly EventRecord[]): GraphSelection {
  const first = [...events].sort((left, right) => left.eventId.localeCompare(right.eventId))[0]
  if (!first) return { operation: null, resource: null, identity: null, source: null, evidenceIds: [] }
  return { operation: first.op, resource: first.resource, identity: first.idn, source: normalizedSource(first.source), evidenceIds: evidenceIds(events) }
}

function nodeSelection(kind: GraphNode["kind"], key: string, events: readonly EventRecord[]): GraphSelection {
  return {
    operation: kind === "operation" ? key : null,
    resource: kind === "resource" ? key : null,
    identity: kind === "identity" ? key : null,
    source: null,
    evidenceIds: evidenceIds(events),
  }
}

export function graphReviewVerdict(snapshot: Snapshot, event: EventRecord): Verdict | "unknown" {
  return snapshot.cells.find((cell) => cell.idn === event.idn && cell.op === event.op && cell.resource === event.resource)?.overall ?? event.verdict ?? "unknown"
}

function toNode(kind: GraphNode["kind"], key: string, events: readonly EventRecord[], snapshot: Snapshot): GraphNode {
  const selection = nodeSelection(kind, key, events)
  const verdicts = new Set(events.map((event) => graphReviewVerdict(snapshot, event)))
  const verdict = verdicts.size === 1 ? [...verdicts][0] : "unknown"
  const style = verdictStyles[verdict]
  return { id: `${kind}:${key}`, kind, label: key, wrappedLabel: kind === "operation" ? wrapOperationLabel(key) : key, verdict, verdictText: style.text, verdictColor: style.color, selection }
}

function includesSupport(event: EventRecord) { return supportClasses.has(event.trafficClass) }

function filteredEvents(snapshot: Snapshot, filters: GraphFilters) {
  const enabledSources = new Set(filters.source.map(normalizedSource))
  const enabledIdentities = new Set(filters.identity)
  const enabledReviewStates = filters.reviewStates ? new Set(filters.reviewStates) : null
  return snapshot.events.filter((event) => event.trafficDisposition === "INCLUDE"
    && enabledSources.has(normalizedSource(event.source))
    && (enabledIdentities.size === 0 || enabledIdentities.has(event.idn))
    && (enabledReviewStates === null || enabledReviewStates.has(graphReviewVerdict(snapshot, event)))
    && (filters.includeSupportTraffic || !includesSupport(event)))
}

function group<T>(events: readonly EventRecord[], key: (event: EventRecord) => T): Map<T, EventRecord[]> {
  const groups = new Map<T, EventRecord[]>()
  for (const event of events) {
    const value = key(event)
    const current = groups.get(value) ?? []
    current.push(event)
    groups.set(value, current)
  }
  return groups
}

function sortedNodes(kind: GraphNode["kind"], groups: Map<string, EventRecord[]>, snapshot: Snapshot, expanded: boolean) {
  const nodes = [...groups.entries()].sort(([left], [right]) => compareText(left, right)).map(([key, events]) => toNode(kind, key, events, snapshot))
  return expanded ? nodes : nodes.slice(0, PAGE_SIZE)
}

function edgeKey(relation: GraphEdge["relation"], sourceId: string, targetId: string, source: GraphEdge["source"], operation = "") {
  return JSON.stringify([relation, sourceId, targetId, source, operation])
}

function buildEdges(events: readonly EventRecord[], visibleNodeIds: ReadonlySet<string>): readonly GraphEdge[] {
  type EdgeBucket = { relation: GraphEdge["relation"]; sourceId: string; targetId: string; source: GraphEdge["source"]; operation: string; events: EventRecord[] }
  const buckets = new Map<string, EdgeBucket>()
  const add = (relation: GraphEdge["relation"], sourceId: string, targetId: string, event: EventRecord) => {
    if (!visibleNodeIds.has(sourceId) || !visibleNodeIds.has(targetId)) return
    const source = normalizedSource(event.source)
    const operation = event.op
    const key = edgeKey(relation, sourceId, targetId, source, operation)
    const bucket = buckets.get(key) ?? { relation, sourceId, targetId, source, operation, events: [] }
    bucket.events.push(event)
    buckets.set(key, bucket)
  }
  for (const event of events) {
    const identityId = `identity:${event.idn}`
    const operationId = `operation:${event.op}`
    if (event.resource) {
      const resourceId = `resource:${event.resource}`
      add("identity-resource", identityId, resourceId, event)
      add("resource-operation", resourceId, operationId, event)
    } else add("identity-operation", identityId, operationId, event)
  }
  return [...buckets.values()].sort((left, right) => left.relation.localeCompare(right.relation) || left.sourceId.localeCompare(right.sourceId) || left.targetId.localeCompare(right.targetId) || left.source.localeCompare(right.source)).map((bucket) => {
    const style = sourceStyles[bucket.source]
    const count = bucket.events.reduce((total, event) => total + Math.max(1, event.repeatCount), 0)
    return { id: edgeKey(bucket.relation, bucket.sourceId, bucket.targetId, bucket.source, bucket.operation), relation: bucket.relation, sourceId: bucket.sourceId, targetId: bucket.targetId, source: bucket.source, ...style, count, countLabel: count > 1 ? `×${count}` : "", selection: eventSelection(bucket.events) }
  })
}

export function wrapOperationLabel(operation: string): string {
  const firstSpace = operation.indexOf(" ")
  if (firstSpace < 0) return operation
  const method = operation.slice(0, firstSpace)
  const path = operation.slice(firstSpace + 1)
  return `${method} ${path.replaceAll("/", "\n/")}`
}

export function projectGraph(snapshot: Snapshot, filters: GraphFilters): GraphProjection {
  const events = filteredEvents(snapshot, filters)
  const identities = sortedNodes("identity", group(events, (event) => event.idn), snapshot, true)
  const resources = sortedNodes("resource", group(events.filter((event) => event.resource !== null), (event) => event.resource ?? ""), snapshot, filters.expanded)
  const operations = sortedNodes("operation", group(events, (event) => event.op), snapshot, filters.expanded)
  const routeCandidates = projectRouteCandidates(snapshot, filters)
  const visibleNodeIds = new Set([...identities, ...resources, ...operations].map((node) => node.id))
  return { view: filters.view, identities, resources, operations, routeCandidates, listItems: operations, edges: buildEdges(events, visibleNodeIds) }
}

/** 경로 후보 하나를 중립 그래프 항목으로 투영한다. `enabledSources`가 있으면 그 source의 provenance를 대표로 고른다. */
export function projectRouteCandidate(candidate: RouteCandidate, enabledSources: ReadonlySet<Source> | null = null): GraphRouteCandidate {
  const id = graphRouteCandidateId(candidate)
  const detail: GraphRouteCandidateDetail = { id, service: candidate.service, method: candidate.method, pathTemplate: candidate.pathTemplate, observed: candidate.observed, applicability: candidate.applicability, provenanceTypes: candidate.provenanceTypes, provenanceEvidenceIds: candidate.provenanceEvidenceIds, provenance: candidate.provenance, reviewReason: candidate.reviewReason, priorityReasons: candidate.priorityReasons }
  const selectedProvenance = enabledSources ? candidate.provenance.find((item) => enabledSources.has(normalizedSource(item.source))) : candidate.provenance[0]
  return { ...candidate, id, label: `${candidate.method} ${candidate.pathTemplate}`, observedText: candidate.observed && candidate.method !== "UNKNOWN" ? "관측됨" : "미관측 후보", selection: { operation: `${candidate.method} ${candidate.pathTemplate}`, resource: null, identity: null, source: normalizedSource(selectedProvenance?.source), evidenceIds: [...candidate.provenanceEvidenceIds].sort(compareText), routeCandidate: detail } }
}

/** 현재 필터가 허용하는 경로 후보만 투영한다: 표시 옵션이 켜져 있고, 신원 필터가 없으며, provenance source가 활성 source에 포함될 때. */
export function projectRouteCandidates(snapshot: Snapshot, filters: GraphFilters): readonly GraphRouteCandidate[] {
  if (!filters.includeRouteCandidates || filters.identity.length > 0) return []
  const enabledSources = new Set(filters.source.map(normalizedSource))
  return snapshot.routeCandidates
    .filter((candidate) => candidate.provenance.length === 0 || candidate.provenance.some((item) => enabledSources.has(normalizedSource(item.source))))
    .map((candidate) => projectRouteCandidate(candidate, enabledSources))
}

export function selectGraphItem(projection: GraphProjection, id: string): GraphSelection | null {
  const node = [...projection.identities, ...projection.resources, ...projection.operations].find((item) => item.id === id)
  if (node) return node.selection
  const candidate = projection.routeCandidates.find((item) => item.id === id)
  if (candidate) return candidate.selection
  return projection.edges.find((item) => item.id === id)?.selection ?? null
}
