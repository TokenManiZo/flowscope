import type { Cell, Snapshot, Source } from "@/lib/api/types"
import { graphCellKey, graphCellSelection, projectRouteCandidates, sourceStyles, verdictStyles, wrapOperationLabel, type GraphCellSelection, type GraphEdge, type GraphFilters, type GraphNode, type GraphRouteCandidate, type GraphView } from "./graphProjection"

export const GRAPH_PAGE_SIZE = 18
export type GraphLevel = "site" | "group" | "operation"

export interface GraphNavigation {
  level: GraphLevel
  groupId: string
  operation: string
  operationLimit: number
  objectLimit: number
  focusCandidateKey: string
}

export interface ApiGroupDescriptor { id: string; service: string; key: string; label: string }
export interface ApiGroup extends ApiGroupDescriptor {
  cells: readonly Cell[]
  operations: readonly string[]
  routeCandidates: readonly GraphRouteCandidate[]
  endpointCount: number
  sourceCounts: Record<"human" | "scanner" | "llm", number>
  gapCount: number
  routeCandidateCount: number
}
export interface HierarchySelection extends GraphCellSelection { gapIds: readonly string[] }
export interface HierarchyNode extends Omit<GraphNode, "kind" | "selection"> {
  kind: GraphNode["kind"] | "target" | "api-group" | "support-operation"
  selection: HierarchySelection
  groupId?: string
  service?: string
  owner?: string | null
}
export interface HierarchyEdge extends Omit<GraphEdge, "relation" | "source" | "selection"> {
  relation: "target-group" | "identity-operation" | "operation-resource" | "candidate" | "support"
  source: Source | null
  structural: boolean
  selection: HierarchySelection
}
export interface HierarchyProjection {
  kind: GraphLevel
  view: GraphView
  navigation: GraphNavigation
  groups: readonly ApiGroup[]
  nodes: readonly HierarchyNode[]
  edges: readonly HierarchyEdge[]
  identities: readonly HierarchyNode[]
  operations: readonly HierarchyNode[]
  resources: readonly HierarchyNode[]
  routeCandidates: readonly GraphRouteCandidate[]
  listItems: readonly HierarchyNode[]
  hiddenOperationCount: number
  hiddenObjectCount: number
}

export function apiGroupDescriptor(service: string, path: string): ApiGroupDescriptor {
  const parts = (path || "/").split("/").filter(Boolean)
  let index = 0
  while (index < parts.length - 1 && (/^(api|rest)$/i.test(parts[index]) || /^v\d+(?:\.\d+)?$/i.test(parts[index]))) index += 1
  const key = (parts[index] || "root").toLowerCase()
  return { id: JSON.stringify([service || "Target", key]), service: service || "Target", key, label: key === "root" ? "ROOT APIs" : `${key.replace(/[-_]+/g, " ").toUpperCase()} APIs` }
}

function operationGroup(operation: string): ApiGroupDescriptor {
  const service = operation.match(/^(https?:\/\/\S+)\s+/i)?.[1] ?? "Target"
  const plain = operation.replace(/^https?:\/\/\S+\s+/i, "")
  const space = plain.indexOf(" ")
  return apiGroupDescriptor(service, space > 0 ? plain.slice(space + 1) : plain)
}

export function navigateHierarchy(current: GraphNavigation, level: GraphLevel, groupId = "", operation = ""): GraphNavigation {
  return { level, groupId, operation, operationLimit: level === "group" && current.groupId === groupId ? current.operationLimit : GRAPH_PAGE_SIZE, objectLimit: GRAPH_PAGE_SIZE, focusCandidateKey: "" }
}

/** 노드를 여는(더블클릭·Enter) 방향. 오른쪽 레인 노드는 한 단계 안으로, 왼쪽 신원 노드는 한 단계 위로 간다. */
export function graphOpenAction(kind: HierarchyNode["kind"], level: GraphLevel): "in" | "back" | null {
  if (kind === "api-group" || (kind === "operation" && level === "group")) return "in"
  if (kind === "identity" && level !== "site") return "back"
  return null
}

export function stepBack(current: GraphNavigation): GraphNavigation {
  if (current.level === "operation") return navigateHierarchy(current, "group", current.groupId)
  if (current.level === "group") return navigateHierarchy(current, "site")
  return current
}

const compareText = (left: string, right: string) => left.localeCompare(right, "en")
const observedSources = (cell: Cell) => (Object.keys(cell.perSource) as Source[]).filter(source => cell.perSource[source] !== undefined)
const isPartial = (cell: Cell) => cell.missedSources.length > 0
const emptySelection = (): HierarchySelection => ({ ...graphCellSelection([]), gapIds: [] })

export function projectHierarchy(snapshot: Snapshot, filters: GraphFilters, navigation: GraphNavigation): HierarchyProjection {
  const identityMatches = (identity: string) => !filters.identity.length || filters.identity.includes(identity)
  const cells = snapshot.cells.filter(cell => identityMatches(cell.idn) && observedSources(cell).some(source => filters.source.includes(source)) && (!filters.reviewStates || filters.reviewStates.includes(cell.overall)))
  const gapIdsByCell = new Map<string, string[]>()
  for (const gap of snapshot.gaps) {
    const key = graphCellKey(gap)
    const ids = gapIdsByCell.get(key) ?? []
    ids.push(gap.id)
    gapIdsByCell.set(key, ids)
  }
  const selectionFor = (related: readonly Cell[], source: Source | null = null): HierarchySelection => ({ ...graphCellSelection(related, source), gapIds: [...new Set(related.flatMap(cell => gapIdsByCell.get(graphCellKey(cell)) ?? []))] })

  // Evidence belongs to the server cell. Event records only supply source attribution;
  // absent/evicted records never remove Evidence IDs from the selection.
  const evidenceSources = new Map<string, Source>()
  for (const event of snapshot.events) for (const id of [event.eventId, ...(event.clusterEvidenceIds ?? [])]) evidenceSources.set(id, event.source)
  const sourceCount = (cell: Cell, source: Source) => {
    const attributed = cell.evidenceIds.filter(id => evidenceSources.get(id) === source).length
    return attributed || (observedSources(cell).includes(source) ? 1 : 0)
  }
  const groupsById = new Map<string, ApiGroup & { cells: Cell[]; routeCandidates: GraphRouteCandidate[] }>()
  const ensure = (descriptor: ApiGroupDescriptor) => {
    let group = groupsById.get(descriptor.id)
    if (!group) {
      group = { ...descriptor, cells: [], operations: [], routeCandidates: [], endpointCount: 0, sourceCounts: { human: 0, scanner: 0, llm: 0 }, gapCount: 0, routeCandidateCount: 0 }
      groupsById.set(group.id, group)
    }
    return group
  }
  for (const cell of cells) {
    const group = ensure(operationGroup(cell.op))
    group.cells.push(cell)
  }
  // Route candidates keep the existing source/identity filter semantics of the flat projection.
  for (const candidate of projectRouteCandidates(snapshot, filters)) {
    const group = ensure(apiGroupDescriptor(candidate.service, candidate.pathTemplate))
    group.routeCandidates.push(candidate)
  }
  for (const group of groupsById.values()) {
    group.operations = [...new Set(group.cells.map(cell => cell.op))]
    group.endpointCount = group.operations.length
    group.routeCandidateCount = group.routeCandidates.length
    for (const source of ["human", "scanner", "llm"] as const) group.sourceCounts[source] = group.cells.reduce((sum, cell) => sum + sourceCount(cell, source), 0)
    const gapKeys = new Set(group.cells.filter(cell => cell.conflict || isPartial(cell)).map(graphCellKey))
    for (const gap of snapshot.gaps) if (gap.type === "UNCROSSED" && identityMatches(gap.idn) && group.operations.includes(gap.op)) gapKeys.add(graphCellKey(gap))
    group.gapCount = gapKeys.size
  }
  const groups = [...groupsById.values()].sort((left, right) => compareText(left.service, right.service) || compareText(left.label, right.label))
  const group = groupsById.get(navigation.groupId)
  let resolved = navigation
  if (navigation.level !== "site" && !group) resolved = navigateHierarchy(navigation, "site")
  else if (navigation.level === "operation" && !group?.operations.includes(navigation.operation)) resolved = navigateHierarchy(navigation, "group", navigation.groupId)

  const nodes: HierarchyNode[] = []
  const edges: HierarchyEdge[] = []
  let listItems: HierarchyNode[] = []
  let routeCandidates: readonly GraphRouteCandidate[] = []
  let hiddenOperationCount = 0
  let hiddenObjectCount = 0
  const addNode = (kind: HierarchyNode["kind"], key: string, selection = emptySelection(), extra: Partial<HierarchyNode> = {}) => {
    const id = `${kind}:${key}`
    const existing = nodes.find(node => node.id === id)
    if (existing) return existing
    // A display node is not a new authorization decision. Keep each server cell
    // in selection; only show a verdict when all selected cells already agree.
    const first = selection.cells[0]?.overall
    const verdict = first && selection.cells.every(cell => cell.overall === first) ? first : "unknown"
    const node: HierarchyNode = { id, kind, label: key, wrappedLabel: kind === "operation" ? wrapOperationLabel(key) : key, verdict, verdictText: verdictStyles[verdict].text, verdictColor: verdictStyles[verdict].color, selection, ...extra }
    nodes.push(node)
    return node
  }
  const addEdge = (relation: HierarchyEdge["relation"], sourceId: string, targetId: string, selection: HierarchySelection, count = 0, eventId?: string) => {
    const source = selection.source
    const style = source === null ? { sourceText: "", line: "dotted" as const, color: "#6b7280" } : sourceStyles[source]
    edges.push({ id: JSON.stringify([relation, sourceId, targetId, source, selection.identity, selection.cellKeys, eventId]), relation, sourceId, targetId, source, structural: relation === "target-group", ...style, count, countLabel: count > 1 ? `×${count}` : "", selection })
  }
  const addAccess = (related: readonly Cell[]) => {
    const buckets = new Map<string, Cell[]>()
    for (const cell of related) for (const source of observedSources(cell).filter(source => filters.source.includes(source))) {
      const key = JSON.stringify([cell.idn, cell.op, source])
      const bucket = buckets.get(key) ?? []
      bucket.push(cell)
      buckets.set(key, bucket)
    }
    for (const [key, bucket] of buckets) {
      const [identity, operation, source] = JSON.parse(key) as [string, string, Source]
      addEdge("identity-operation", `identity:${identity}`, `operation:${operation}`, selectionFor(bucket, source), bucket.reduce((sum, cell) => sum + sourceCount(cell, source), 0))
    }
  }

  if (resolved.level === "site") {
    for (const item of groups) {
      const target = addNode("target", item.service, emptySelection(), { service: item.service })
      const node = addNode("api-group", item.id, emptySelection(), { groupId: item.id, service: item.service, label: item.label, wrappedLabel: item.label })
      addEdge("target-group", target.id, node.id, emptySelection())
      listItems.push(node)
    }
  } else if (group && resolved.level === "group") {
    const scores = new Map<string, number>()
    for (const cell of group.cells) scores.set(cell.op, (scores.get(cell.op) ?? 0) + (cell.overall === "suspicious" ? 100 : cell.conflict ? 60 : isPartial(cell) ? 20 : 1) + cell.evidenceIds.length)
    const operations = [...group.operations].sort((left, right) => (scores.get(right) ?? 0) - (scores.get(left) ?? 0) || compareText(left, right))
    const visible = operations.slice(0, resolved.operationLimit)
    const related = group.cells.filter(cell => visible.includes(cell.op))
    for (const identity of new Set(related.map(cell => cell.idn))) addNode("identity", identity, selectionFor(related.filter(cell => cell.idn === identity)))
    listItems = visible.map(op => addNode("operation", op, selectionFor(related.filter(cell => cell.op === op))))
    addAccess(related)
    hiddenOperationCount = operations.length - visible.length
    routeCandidates = group.routeCandidates.slice(0, resolved.operationLimit)
    for (const candidate of routeCandidates) addNode("route-candidate", candidate.id, { ...emptySelection(), ...candidate.selection }, { id: candidate.id, label: candidate.label, wrappedLabel: wrapOperationLabel(candidate.label) })
    if (filters.includeSupportTraffic) {
      const supportClasses = new Set(["AUTH_SESSION", "NAVIGATION", "POLLING", "BACKGROUND"])
      const supportEvents = snapshot.events.filter(event => filters.source.includes(event.source) && identityMatches(event.idn) && event.trafficDisposition !== "INCLUDE" && supportClasses.has(event.trafficClass) && operationGroup(event.op).id === group.id)
      const supportOps = [...new Set(supportEvents.map(event => event.op).filter(op => !visible.includes(op)))].slice(0, resolved.operationLimit)
      const supportEvidence = (event: Snapshot["events"][number]) => event.clusterEvidenceIds?.length ? event.clusterEvidenceIds : [event.eventId]
      for (const op of supportOps) {
        const events = supportEvents.filter(event => event.op === op)
        addNode("support-operation", op, { ...emptySelection(), operation: op, evidenceIds: [...new Set(events.flatMap(supportEvidence))].sort(compareText) })
      }
      for (const event of supportEvents.filter(event => supportOps.includes(event.op))) {
        addNode("identity", event.idn, { ...emptySelection(), identity: event.idn })
        addEdge("support", `identity:${event.idn}`, `support-operation:${event.op}`, { ...emptySelection(), identity: event.idn, operation: event.op, source: event.source, evidenceIds: supportEvidence(event) }, 0, event.eventId)
      }
    }
  } else if (group) {
    const operation = resolved.operation
    const related = group.cells.filter(cell => cell.op === operation)
    const candidates = resolved.focusCandidateKey ? snapshot.gaps.filter(gap => gap.type === "UNCROSSED" && gap.op === operation && identityMatches(gap.idn)) : []
    const scores = new Map<string, number>()
    for (const cell of related) if (cell.resource) scores.set(cell.resource, (scores.get(cell.resource) ?? 0) + (cell.overall === "suspicious" ? 100 : cell.conflict ? 60 : 1))
    const focusedResource = candidates.find(gap => graphCellKey(gap) === resolved.focusCandidateKey)?.resource
    const resources = [...new Set([...related.map(cell => cell.resource), ...candidates.map(gap => gap.resource)].filter((resource): resource is string => !!resource))].sort((left, right) => Number(right === focusedResource) - Number(left === focusedResource) || (scores.get(right) ?? 0) - (scores.get(left) ?? 0) || compareText(left, right))
    const visible = resources.slice(0, resolved.objectLimit)
    for (const identity of new Set([...related.map(cell => cell.idn), ...candidates.filter(gap => gap.resource && visible.includes(gap.resource)).map(gap => gap.idn)])) addNode("identity", identity, { ...selectionFor(related.filter(cell => cell.idn === identity)), identity })
    addNode("operation", operation, selectionFor(related))
    for (const resource of visible) addNode("resource", resource, { ...selectionFor(related.filter(cell => cell.resource === resource)), operation, resource }, { owner: snapshot.owners[resource] ?? null })
    addAccess(related)
    for (const cell of related.filter(cell => cell.resource && visible.includes(cell.resource))) for (const source of observedSources(cell).filter(source => filters.source.includes(source))) addEdge("operation-resource", `operation:${operation}`, `resource:${cell.resource}`, selectionFor([cell], source), sourceCount(cell, source))
    const visibleCandidates = candidates.filter(gap => gap.resource && visible.includes(gap.resource))
      .sort((left, right) => Number(graphCellKey(right) === resolved.focusCandidateKey) - Number(graphCellKey(left) === resolved.focusCandidateKey))
    for (const gap of visibleCandidates.slice(0, 40)) {
      const selection: HierarchySelection = { ...emptySelection(), identity: gap.idn, operation, resource: gap.resource, cellKeys: [graphCellKey(gap)], gapIds: [gap.id] }
      addEdge("candidate", `identity:${gap.idn}`, `operation:${operation}`, selection)
      addEdge("candidate", `operation:${operation}`, `resource:${gap.resource}`, selection)
    }
    hiddenObjectCount = resources.length - visible.length
    // Per-cell list entries retain identity and objectless selections, just as
    // the narrow-screen list does, without creating extra graph nodes.
    listItems = related.map(cell => ({ id: `cell:${graphCellKey(cell)}`, kind: cell.resource ? "resource" : "operation", label: cell.resource ?? operation, wrappedLabel: cell.resource ?? wrapOperationLabel(operation), verdict: cell.overall, verdictText: verdictStyles[cell.overall].text, verdictColor: verdictStyles[cell.overall].color, selection: selectionFor([cell]), ...(cell.resource ? { owner: snapshot.owners[cell.resource] ?? null } : {}) }))
  }
  return { kind: resolved.level, view: filters.view, navigation: resolved, groups, nodes, edges, identities: nodes.filter(node => node.kind === "identity"), operations: nodes.filter(node => node.kind === "operation"), resources: nodes.filter(node => node.kind === "resource"), routeCandidates, listItems, hiddenOperationCount, hiddenObjectCount }
}

/** 그래프 상단 카운트. 현재 단계에 실제로 그려진 노드만 센다(사이트 개요에는 신원·API·객체 노드가 없다). */
export function graphCountLabel(graph: HierarchyProjection): string {
  if (graph.kind === "site") return `${graph.nodes.filter(node => node.kind === "api-group").length} API groups`
  const parts = [`${graph.identities.length} identities`, `${graph.operations.length} operations`]
  if (graph.kind === "operation") parts.push(`${graph.resources.length} resources`)
  return parts.join(" · ")
}
