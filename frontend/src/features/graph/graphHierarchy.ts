import { operationShapeKey } from "./graphPathShape"
import type { Cell, EventRecord, Snapshot, Source } from "@/lib/api/types"
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
  observedCount: number
  sourceCounts: Record<"human" | "scanner" | "llm", number>
  gapCount: number
  routeCandidateCount: number
}
export interface HierarchySelection extends GraphCellSelection { gapIds: readonly string[] }
export interface HierarchyNode extends Omit<GraphNode, "kind" | "selection"> {
  kind: GraphNode["kind"] | "target" | "api-group" | "support-operation" | "observed-operation" | "object-group" | "operation-group"
  selection: HierarchySelection
  groupId?: string
  service?: string
  owner?: string | null
  /** 이 객체를 조회하는 API가 공개 정책(PUBLIC)이면 true. 카드·패널이 소유자 대신 Public으로 보여 준다. */
  publicRead?: boolean
  /** 객체 묶음 노드: 묶음 이름, 묶인 객체 ID, 객체별 서버 소유자, 펼침 여부. */
  objectGroup?: { key: string; members: readonly string[]; owners: Readonly<Record<string, string | null>>; expanded: boolean }
  /** 접힌 API 묶음의 멤버. 그래프에서는 그리지 않고 목록·선택 상세에서만 쓴다. */
  hiddenInGraph?: boolean
}
export interface HierarchyEdge extends Omit<GraphEdge, "relation" | "source" | "selection"> {
  relation: "target-group" | "identity-operation" | "operation-resource" | "candidate" | "support" | "observed"
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
  revealedNodeCount?: number
}

/** 이 조회 API가 이 객체에 대해 공개 정책(PUBLIC)인지. 서버 권한 매트릭스의 객체 칸을 따른다. */
export function isPublicRead(snapshot: Snapshot, operation: string, resource: string): boolean {
  return snapshot.authorizationMatrix?.objects.some(cell => cell.operation === operation && cell.resource === resource && cell.resourcePolicy === "PUBLIC") ?? false
}

export function apiGroupDescriptor(service: string, path: string): ApiGroupDescriptor {
  const parts = (path || "/").split("/").filter(Boolean)
  let index = 0
  while (index < parts.length - 1 && (/^(api|rest)$/i.test(parts[index]) || /^v\d+(?:\.\d+)?$/i.test(parts[index]))) index += 1
  const key = (parts[index] || "root").toLowerCase()
  return { id: JSON.stringify([service || "Target", key]), service: service || "Target", key, label: key === "root" ? "ROOT APIs" : `${key.replace(/[-_]+/g, " ").toUpperCase()} APIs` }
}

export function operationGroup(operation: string): ApiGroupDescriptor {
  const service = operation.match(/^(https?:\/\/\S+)\s+/i)?.[1] ?? "Target"
  const plain = operation.replace(/^https?:\/\/\S+\s+/i, "")
  const space = plain.indexOf(" ")
  return apiGroupDescriptor(service, space > 0 ? plain.slice(space + 1) : plain)
}

export function navigateHierarchy(current: GraphNavigation, level: GraphLevel, groupId = "", operation = ""): GraphNavigation {
  return { level, groupId, operation, operationLimit: level === "group" && current.groupId === groupId ? current.operationLimit : GRAPH_PAGE_SIZE, objectLimit: GRAPH_PAGE_SIZE, focusCandidateKey: "" }
}

/** 노드를 여는(더블클릭·Enter) 방향. 오른쪽 레인 노드는 한 단계 안으로, 왼쪽 신원 노드는 한 단계 위로 간다. */
/** 객체 묶음 기준: 객체 ID에서 서비스 주소를 뺀 뒤 ":" 앞부분. ":"이 없으면 묶지 않는다(예: "https://a.test orders:13" → orders). */
export function objectGroupKey(resource: string): { id: string; key: string } | null {
  const space = resource.lastIndexOf(" ")
  const local = resource.slice(space + 1), colon = local.indexOf(":")
  if (colon <= 0) return null
  const key = local.slice(0, colon)
  return { id: `${space >= 0 ? resource.slice(0, space) : ""}|${key}`, key }
}

export function graphOpenAction(kind: HierarchyNode["kind"], level: GraphLevel): "in" | "back" | "toggle" | null {
  if (kind === "object-group" || kind === "operation-group") return "toggle"
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
const nonFunctionTraffic = new Set(["STATIC_ASSET", "DISCOVERY_METADATA", "PREFLIGHT", "POLLING", "BACKGROUND", "TELEMETRY_CANDIDATE", "AUTH_SESSION"])
const nonDiscoveryPhases = new Set(["VALIDATION", "COACH_PROBE", "SESSION_SETUP", "AUTHORIZATION_REPLAY"])

/** 실제 응답을 받은 요청만 중립 노드 후보로 둔다. 분류·상태 코드는 존재/권한 판정이 아니다. */
function observedFunction(event: EventRecord): boolean {
  return event.source !== "unknown" && event.executionTrust !== "UNVERIFIED_RUNTIME"
    && event.status >= 100 && event.status <= 599
    && !event.classificationReasons.includes("NO_RESPONSE")
    && !event.classificationReasons.includes("USER_EXCLUDE")
    && !(event.classificationOverride && event.trafficDisposition === "EXCLUDE")
    && !nonFunctionTraffic.has(event.trafficClass)
    && !nonDiscoveryPhases.has(event.phase)
}

const eventEvidenceIds = (event: EventRecord) => [...new Set([event.eventId, ...(event.clusterEvidenceIds ?? [])])].sort(compareText)

export interface GraphReveal { operations?: readonly string[]; resource?: string }

export function projectHierarchy(snapshot: Snapshot, filters: GraphFilters, navigation: GraphNavigation, reveal: GraphReveal = {}): HierarchyProjection {
  const identityMatches = (identity: string) => !filters.identity.length || filters.identity.includes(identity)
  const cells = snapshot.cells.filter(cell => identityMatches(cell.idn) && observedSources(cell).some(source => filters.source.includes(source)) && (!filters.reviewStates || filters.reviewStates.includes(cell.overall)))
  const judgedEvidence = new Set(snapshot.cells.flatMap(cell => cell.evidenceIds))
  const observedEvents = snapshot.events.filter(event => observedFunction(event)
    && !eventEvidenceIds(event).some(id => judgedEvidence.has(id)) && filters.source.includes(event.source) && identityMatches(event.idn))
  const observedByGroup = new Map<string, EventRecord[]>()
  for (const event of observedEvents) {
    const id = operationGroup(event.op).id
    const grouped = observedByGroup.get(id)
    if (grouped) grouped.push(event)
    else observedByGroup.set(id, [event])
  }
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
      group = { ...descriptor, cells: [], operations: [], routeCandidates: [], endpointCount: 0, observedCount: 0, sourceCounts: { human: 0, scanner: 0, llm: 0 }, gapCount: 0, routeCandidateCount: 0 }
      groupsById.set(group.id, group)
    }
    return group
  }
  for (const cell of cells) {
    const group = ensure(operationGroup(cell.op))
    group.cells.push(cell)
  }
  for (const event of observedEvents) ensure(operationGroup(event.op))
  // Route candidates keep the existing source/identity filter semantics of the flat projection.
  for (const candidate of projectRouteCandidates(snapshot, filters)) {
    const group = ensure(apiGroupDescriptor(candidate.service, candidate.pathTemplate))
    group.routeCandidates.push(candidate)
  }
  for (const group of groupsById.values()) {
    group.operations = [...new Set(group.cells.map(cell => cell.op))]
    group.endpointCount = group.operations.length
    group.observedCount = new Set((observedByGroup.get(group.id) ?? []).map(event => event.op).filter(op => !group.operations.includes(op))).size
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
  let revealedNodeCount = 0
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

  const addObserved = (observed: readonly EventRecord[], node: HierarchyNode) => {
    node.selection = { ...node.selection, evidenceIds: [...new Set([...node.selection.evidenceIds, ...observed.flatMap(eventEvidenceIds)])].sort(compareText) }
    const buckets = new Map<string, EventRecord[]>()
    for (const event of observed) {
      const key = JSON.stringify([event.idn, event.source])
      buckets.set(key, [...(buckets.get(key) ?? []), event])
    }
    for (const [key, events] of buckets) {
      const [identity, source] = JSON.parse(key) as [string, Source]
      const evidenceIds = [...new Set(events.flatMap(eventEvidenceIds))].sort(compareText)
      const identityNode = addNode("identity", identity, { ...emptySelection(), identity })
      identityNode.selection = { ...identityNode.selection, evidenceIds: [...new Set([...identityNode.selection.evidenceIds, ...evidenceIds])].sort(compareText) }
      addEdge("observed", identityNode.id, node.id, { ...emptySelection(), identity, operation: node.selection.operation, source, evidenceIds }, events.length)
    }
  }

  // 그룹 화면에서는 객체를 종류별 묶음으로 둔다. 접힌 묶음은 노드 하나와 API→묶음 엣지(출처별)만, 펼친 묶음은 머리 노드 바로 아래에 개별 객체를 둔다.
  // 묶이지 않는 객체(":" 없음)만 objectLimit로 접고 "더 보기"로 펼친다. API 하나를 연 화면(grouped=false)은 객체를 하나씩 그린다(목록 모드에도 펼칠 버튼이 없다).
  // 반환값은 개별 객체 노드로 그린 객체다.
  const expandedGroups = new Set(filters.expandedObjectGroups ?? [])
  const addObjects = (resources: readonly string[], related: readonly Cell[], resourceSelection: (resource: string) => HierarchySelection, resourceExtra: (resource: string) => Partial<HierarchyNode>, grouped: boolean) => {
    const groupOf = (resource: string) => grouped ? objectGroupKey(resource) : null
    const members = new Map<string, string[]>()
    for (const resource of resources) {
      const group = groupOf(resource)
      if (group) members.set(group.id, [...(members.get(group.id) ?? []), resource])
    }
    const drawn: string[] = [], placed = new Set<string>()
    let singles = 0
    for (const resource of resources) {
      const group = groupOf(resource)
      if (!group) {
        singles++
        if (singles > resolved.objectLimit && resource === reveal.resource) revealedNodeCount++
        if (singles <= resolved.objectLimit || resource === reveal.resource) { addNode("resource", resource, resourceSelection(resource), resourceExtra(resource)); drawn.push(resource) }
        continue
      }
      if (placed.has(group.id)) continue
      placed.add(group.id)
      const items = members.get(group.id) ?? [], open = expandedGroups.has(`object-group:${group.id}`)
      const cells = related.filter(cell => cell.resource && items.includes(cell.resource))
      addNode("object-group", group.id, selectionFor(cells), { label: group.key, wrappedLabel: group.key, objectGroup: { key: group.key, members: items, owners: Object.fromEntries(items.map(item => [item, snapshot.owners[item] ?? null])), expanded: open } })
      if (open) {
        for (const item of items) { addNode("resource", item, resourceSelection(item), resourceExtra(item)); drawn.push(item) }
        continue
      }
      const buckets = new Map<string, Cell[]>()
      for (const cell of cells) for (const source of observedSources(cell).filter(source => filters.source.includes(source))) {
        const bucketKey = JSON.stringify([cell.op, source])
        buckets.set(bucketKey, [...(buckets.get(bucketKey) ?? []), cell])
      }
      for (const [bucketKey, bucket] of buckets) {
        const [op, source] = JSON.parse(bucketKey) as [string, Source]
        addEdge("operation-resource", `operation:${op}`, `object-group:${group.id}`, selectionFor(bucket, source), bucket.reduce((sum, cell) => sum + sourceCount(cell, source), 0))
      }
    }
    return { drawn, hidden: Math.max(0, singles - drawn.filter(resource => !groupOf(resource)).length) }
  }

  // 같은 경로 형식(숫자·UUID·긴 토큰 → {id})의 API가 둘 이상이면 객체 묶음처럼 API 묶음 노드로 접는다(API 목록 표와 같은 기준).
  // 묶음 노드는 첫 멤버 자리에 두고 멤버를 바로 아래로 모은다. 접힌 묶음은 멤버 API 노드를 그래프에서만 숨기고(목록·선택 상세에는
  // 남는다) 신원→API·API→객체 엣지를 묶음 노드로 모아 같은 출처·신원 엣지를 하나로 합친다.
  const groupOperations = (visible: readonly string[], related: readonly Cell[]) => {
    const shapes = new Map<string, string[]>()
    for (const op of visible) { const shape = operationShapeKey(op); shapes.set(shape, [...(shapes.get(shape) ?? []), op]) }
    const collapsed = new Map<string, string>()
    for (const [shape, ops] of shapes) {
      if (ops.length < 2) continue
      const id = `operation-group:${shape}`, open = expandedGroups.has(id)
      const groupSelection = selectionFor(related.filter(cell => ops.includes(cell.op)))
      groupSelection.evidenceIds = [...new Set(nodes.filter(node => node.kind === "operation" && ops.includes(node.selection.operation ?? "")).flatMap(node => node.selection.evidenceIds))].sort(compareText)
      const groupNode = addNode("operation-group", shape, groupSelection, { label: shape, wrappedLabel: wrapOperationLabel(shape), objectGroup: { key: shape, members: ops, owners: {}, expanded: open } })
      const members = ops.map(op => nodes.find(node => node.id === `operation:${op}`)).filter((node): node is HierarchyNode => !!node)
      const at = Math.min(...members.map(member => nodes.indexOf(member)))
      for (const node of [groupNode, ...members]) nodes.splice(nodes.indexOf(node), 1)
      nodes.splice(Math.min(at, nodes.length), 0, groupNode, ...members)
      if (open) continue
      for (const member of members) { member.hiddenInGraph = true; collapsed.set(member.id, id) }
    }
    if (!collapsed.size) return
    const merged = new Map<string, HierarchyEdge[]>()
    for (const edge of edges.splice(0)) {
      const sourceId = collapsed.get(edge.sourceId) ?? edge.sourceId, targetId = collapsed.get(edge.targetId) ?? edge.targetId
      if (sourceId === edge.sourceId && targetId === edge.targetId) { edges.push(edge); continue }
      const key = JSON.stringify([edge.relation, sourceId, targetId, edge.source, edge.selection.identity])
      merged.set(key, [...(merged.get(key) ?? []), { ...edge, sourceId, targetId }])
    }
    for (const parts of merged.values()) {
      const cells = [...new Set(parts.flatMap(edge => edge.selection.cells))]
      const selection = { ...selectionFor(cells, parts[0].source), identity: parts[0].selection.identity, operation: cells.length ? selectionFor(cells).operation : parts[0].selection.operation, evidenceIds: [...new Set(parts.flatMap(edge => edge.selection.evidenceIds))].sort(compareText) }
      addEdge(parts[0].relation, parts[0].sourceId, parts[0].targetId, selection, parts.reduce((sum, edge) => sum + edge.count, 0))
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
    for (const operation of reveal.operations ?? []) if (operations.includes(operation) && !visible.includes(operation)) { visible.push(operation); revealedNodeCount++ }
    const related = group.cells.filter(cell => visible.includes(cell.op))
    for (const identity of new Set(related.map(cell => cell.idn))) addNode("identity", identity, selectionFor(related.filter(cell => cell.idn === identity)))
    listItems = visible.map(op => addNode("operation", op, selectionFor(related.filter(cell => cell.op === op))))
    addAccess(related)
    const observed = observedByGroup.get(group.id) ?? []
    const observedByOperation = new Map<string, EventRecord[]>()
    for (const event of observed) {
      const grouped = observedByOperation.get(event.op)
      if (grouped) grouped.push(event)
      else observedByOperation.set(event.op, [event])
    }
    const observedOps = [...observedByOperation.keys()].filter(op => !group.operations.includes(op)).sort(compareText)
    const visibleObserved = observedOps.slice(0, Math.max(0, resolved.operationLimit - visible.length))
    for (const op of [...visible, ...visibleObserved]) {
      const relatedEvents = observedByOperation.get(op) ?? []
      if (!relatedEvents.length) continue
      const existing = nodes.find(node => node.id === `operation:${op}`)
      const node = existing ?? addNode("observed-operation", op, { ...emptySelection(), operation: op })
      if (!existing) listItems.push(node)
      addObserved(relatedEvents, node)
    }
    // 그룹 레벨에서도 객체(자원)를 세 번째 레인에 함께 그린다. 옛 그래프처럼 신원 → API → 객체를 한 화면에서 보되,
    // 객체가 많으면 objectLimit로 접고 "더 보기"로 펼친다(오퍼레이션 레벨과 같은 접기/펼치기).
    const resourceScores = new Map<string, number>()
    for (const cell of related) if (cell.resource) resourceScores.set(cell.resource, (resourceScores.get(cell.resource) ?? 0) + (cell.overall === "suspicious" ? 100 : cell.conflict ? 60 : 1))
    const groupResources = [...new Set(related.map(cell => cell.resource).filter((resource): resource is string => !!resource))].sort((left, right) => (resourceScores.get(right) ?? 0) - (resourceScores.get(left) ?? 0) || compareText(left, right))
    const objects = addObjects(groupResources, related, resource => ({ ...selectionFor(related.filter(cell => cell.resource === resource)), resource }), resource => ({ owner: snapshot.owners[resource] ?? null }), true)
    const visibleResources = objects.drawn
    for (const cell of related.filter(cell => cell.resource && visibleResources.includes(cell.resource))) for (const source of observedSources(cell).filter(source => filters.source.includes(source))) addEdge("operation-resource", `operation:${cell.op}`, `resource:${cell.resource}`, selectionFor([cell], source), sourceCount(cell, source))
    hiddenObjectCount = objects.hidden
    hiddenOperationCount = operations.length - visible.length + observedOps.length - visibleObserved.length
    groupOperations(visible, related)
    routeCandidates = group.routeCandidates.slice(0, resolved.operationLimit)
    for (const candidate of routeCandidates) addNode("route-candidate", candidate.id, { ...emptySelection(), ...candidate.selection }, { id: candidate.id, label: candidate.label, wrappedLabel: wrapOperationLabel(candidate.label) })
    if (filters.includeSupportTraffic) {
      const supportClasses = new Set(["AUTH_SESSION", "NAVIGATION", "POLLING", "BACKGROUND"])
      const supportEvents = snapshot.events.filter(event => filters.source.includes(event.source) && identityMatches(event.idn) && event.trafficDisposition !== "INCLUDE" && supportClasses.has(event.trafficClass) && !observedFunction(event) && operationGroup(event.op).id === group.id)
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
    const operationNode = addNode("operation", operation, selectionFor(related))
    const objects = addObjects(resources, related, resource => ({ ...selectionFor(related.filter(cell => cell.resource === resource)), operation, resource }), resource => ({ owner: snapshot.owners[resource] ?? null, publicRead: isPublicRead(snapshot, operation, resource) }), false)
    const visible = objects.drawn
    for (const identity of new Set([...related.map(cell => cell.idn), ...candidates.filter(gap => gap.resource && visible.includes(gap.resource)).map(gap => gap.idn)])) addNode("identity", identity, { ...selectionFor(related.filter(cell => cell.idn === identity)), identity })
    addAccess(related)
    addObserved((observedByGroup.get(group.id) ?? []).filter(event => event.op === operation), operationNode)
    for (const cell of related.filter(cell => cell.resource && visible.includes(cell.resource))) for (const source of observedSources(cell).filter(source => filters.source.includes(source))) addEdge("operation-resource", `operation:${operation}`, `resource:${cell.resource}`, selectionFor([cell], source), sourceCount(cell, source))
    const visibleCandidates = candidates.filter(gap => gap.resource && visible.includes(gap.resource))
      .sort((left, right) => Number(graphCellKey(right) === resolved.focusCandidateKey) - Number(graphCellKey(left) === resolved.focusCandidateKey))
    for (const gap of visibleCandidates.slice(0, 40)) {
      const selection: HierarchySelection = { ...emptySelection(), identity: gap.idn, operation, resource: gap.resource, cellKeys: [graphCellKey(gap)], gapIds: [gap.id] }
      addEdge("candidate", `identity:${gap.idn}`, `operation:${operation}`, selection)
      addEdge("candidate", `operation:${operation}`, `resource:${gap.resource}`, selection)
    }
    hiddenObjectCount = objects.hidden
    // Per-cell list entries retain identity and objectless selections, just as
    // the narrow-screen list does, without creating extra graph nodes.
    listItems = related.map(cell => ({ id: `cell:${graphCellKey(cell)}`, kind: cell.resource ? "resource" : "operation", label: cell.resource ?? operation, wrappedLabel: cell.resource ?? wrapOperationLabel(operation), verdict: cell.overall, verdictText: verdictStyles[cell.overall].text, verdictColor: verdictStyles[cell.overall].color, selection: selectionFor([cell]), ...(cell.resource ? { owner: snapshot.owners[cell.resource] ?? null } : {}) }))
  }
  return { kind: resolved.level, view: filters.view, navigation: resolved, groups, nodes, edges, identities: nodes.filter(node => node.kind === "identity"), operations: nodes.filter(node => node.kind === "operation"), resources: nodes.filter(node => node.kind === "resource"), routeCandidates, listItems, hiddenOperationCount, hiddenObjectCount, revealedNodeCount }
}
