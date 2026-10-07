import { graphAccountLabel } from "./graphAccounts"
import { operationShapeKey } from "./graphPathShape"
import type { Cell, RouteCandidate, Snapshot, Source } from "@/lib/api/types"
import { manualResendDetails } from "./resendGraph"
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
  /** "관측 전체" 보기에서만 채운다: 판정 셀 없이 관측만 된 기능 수. */
  observedCount: number
}
export interface HierarchySelection extends GraphCellSelection { gapIds: readonly string[] }
export interface HierarchyNode extends Omit<GraphNode, "kind" | "selection"> {
  kind: GraphNode["kind"] | "target" | "api-group" | "observed-operation" | "object-group" | "operation-group" | "support-operation" | "resend-operation"
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
  /** 재전송 그래프의 API 카드: 도구, 보낸 횟수, 최근 응답 코드, 원본 응답 코드(Request Lab만, 없으면 null). */
  resend?: { tool: "lab" | "repeater"; count: number; status: number; originalStatus: number | null }
}
export interface HierarchyEdge extends Omit<GraphEdge, "relation" | "source" | "selection"> {
  relation: "target-group" | "identity-operation" | "operation-resource" | "candidate" | "support" | "resend"
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
  revealedNodeCount: number
}

/** 이 조회 API가 이 객체에 대해 공개 정책(PUBLIC)인지. 서버 권한 매트릭스의 객체 칸을 따른다. */
export function isPublicRead(snapshot: Snapshot, operation: string, resource: string): boolean {
  return snapshot.authorizationMatrix?.objects.some(cell => cell.operation === operation && cell.resource === resource && cell.resourcePolicy === "PUBLIC") ?? false
}

/** "관측 전체" 보기에서도 빼는 요청: 정적 파일과 CORS 사전 요청. 판정과 무관한 표시 전용 기준이다. */
const hiddenTrafficClasses = new Set(["STATIC_ASSET", "PREFLIGHT", "DISCOVERY_METADATA"])
/** 탐색 중 그대로 관측한 요청이 아닌 단계: 로그인 확인, 교차 신원 재전송, LLM 확인 요청, Request Lab 같은 수동 재전송. */
const nonCollectionPhases = new Set(["SESSION_SETUP", "AUTHORIZATION_REPLAY", "COACH_PROBE", "VALIDATION"])
const staticExtension = /\.(?:m?js|css|map|png|jpe?g|gif|svg|ico|webp|avif|bmp|woff2?|ttf|eot|mp3|mp4|webm)$/i

/**
 * 그래프에 그릴 정상 수집 요청인지 본다. 값을 바꿔 다시 보낸 요청(Request Lab, Burp Repeater·Intruder)과 FlowScope가 재전송한 요청은
 * 출처가 아니므로(D-008) 그리지 않는다. Request Lab·Repeater 전송은 재전송 그래프(resendGraph)에서 따로 본다. 응답 없는 시도, 사용자가 직접 제외한 요청, 출처·실행 환경을 확인하지 못한 요청도 뺀다.
 */
export function isObservedTraffic(event: Snapshot["events"][number]): boolean {
  return event.source !== "unknown" && event.executionTrust !== "UNVERIFIED_RUNTIME" && !nonCollectionPhases.has(event.phase)
    && event.status >= 100 && event.status <= 599 && !event.classificationReasons.includes("NO_RESPONSE")
    && !event.classificationReasons.includes("USER_EXCLUDE") && !(event.classificationOverride && event.trafficDisposition === "EXCLUDE")
    && !hiddenTrafficClasses.has(event.trafficClass) && !staticExtension.test(event.path.split("?")[0])
    && !manualResendDetails.has(event.sourceDetail)
}

/** 묶음 기준 칸(api·rest·버전 다음 첫 칸)과, 그 칸이 경로의 마지막 칸인지(/login.php처럼 한 칸짜리 주소인지). */
function groupSegment(path: string): { key: string; leaf: boolean } {
  const parts = (path || "/").split("/").filter(Boolean)
  let index = 0
  while (index < parts.length - 1 && (/^(api|rest)$/i.test(parts[index]) || /^v\d+(?:\.\d+)?$/i.test(parts[index]))) index += 1
  return { key: (parts[index] || "root").toLowerCase(), leaf: index >= parts.length - 1 }
}

/**
 * JS 코드에서 찾았지만 아직 요청하지 않은 API. 정적 파일 모양(/{id}/{id}/styles.css처럼 확장자가 정적 파일이거나
 * 첫 칸부터 변수인 경로)은 숨은 API가 아니라 자산 경로라서 뺀다.
 */
export function isJavascriptHiddenApi(candidate: Pick<RouteCandidate, "observed" | "method" | "pathTemplate" | "provenanceTypes">): boolean {
  return !candidate.observed && candidate.method !== "UNKNOWN" && candidate.provenanceTypes.includes("JAVASCRIPT_LITERAL")
    && !staticExtension.test(candidate.pathTemplate.split("?")[0]) && !/^\/\{/.test(candidate.pathTemplate)
}

const isWriteOperation = (operation: string) => /^(POST|PUT|PATCH|DELETE)\s/i.test(operation.replace(/^https?:\/\/\S+\s+/i, ""))

export function apiGroupDescriptor(service: string, path: string): ApiGroupDescriptor {
  const { key } = groupSegment(path)
  return { id: JSON.stringify([service || "Target", key]), service: service || "Target", key, label: key === "root" ? "ROOT APIs" : `${key.replace(/[-_]+/g, " ").toUpperCase()} APIs` }
}

function splitOperation(operation: string): { service: string; path: string } {
  const service = operation.match(/^(https?:\/\/\S+)\s+/i)?.[1] ?? "Target"
  const plain = operation.replace(/^https?:\/\/\S+\s+/i, "")
  const space = plain.indexOf(" ")
  return { service, path: space > 0 ? plain.slice(space + 1) : plain }
}

/**
 * 한 칸짜리 주소(/login.php, /dashboard)가 혼자 묶음을 차지하면 같은 서비스의 ROOT 묶음으로 모은다.
 * 같은 첫 칸을 쓰는 다른 경로가 있으면(/orders와 /orders/{id}) 그대로 둔다. 보기 범위·필터를 바꿔도
 * 묶음이 옮겨 다니지 않도록 판정 셀·경로 후보·정적 파일이 아닌 관측 요청 전체로 판단한다. 판정은 바꾸지 않는다.
 */
export function apiGroupResolver(snapshot: Snapshot): (service: string, path: string) => ApiGroupDescriptor {
  const paths = new Map<string, Set<string>>()
  const add = (service: string, path: string) => {
    const id = apiGroupDescriptor(service, path).id
    const known = paths.get(id)
    if (known) known.add(path); else paths.set(id, new Set([path]))
  }
  for (const cell of snapshot.cells) { const { service, path } = splitOperation(cell.op); add(service, path) }
  for (const candidate of snapshot.routeCandidates) add(candidate.service, candidate.pathTemplate)
  for (const event of snapshot.events) if (isObservedTraffic(event)) { const { service, path } = splitOperation(event.op); add(service, path) }
  return (service, path) => {
    const descriptor = apiGroupDescriptor(service, path)
    return groupSegment(path).leaf && (paths.get(descriptor.id)?.size ?? 0) <= 1 ? apiGroupDescriptor(service, "/") : descriptor
  }
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

export function operationGroup(operation: string, resolve = apiGroupDescriptor): ApiGroupDescriptor {
  const { service, path } = splitOperation(operation)
  return resolve(service, path)
}

const eventEvidenceIds = (event: Snapshot["events"][number]) => [...new Set([event.eventId, ...(event.clusterEvidenceIds ?? [])])]

/** Graph and search share the eligible data and group resolver before folding or limits. */
export function graphContents(snapshot: Snapshot, filters: GraphFilters) {
  const resolveGroup = apiGroupResolver(snapshot)
  const identityMatches = (identity: string) => !filters.identity.length || filters.identity.includes(identity)
  const cells = snapshot.cells.filter(cell => identityMatches(cell.idn) && observedSources(cell).some(source => filters.source.includes(source)) && (!filters.reviewStates || filters.reviewStates.includes(cell.overall)))
  const judgedEvidence = new Set(snapshot.cells.flatMap(cell => cell.evidenceIds))
  const cellOperations = new Set(cells.map(cell => cell.op))
  const auxiliaryClasses = new Set(["POLLING", "BACKGROUND", "AUTH_SESSION", "TELEMETRY_CANDIDATE"])
  const unjudgedEvents = snapshot.events.filter(event => filters.source.includes(event.source) && identityMatches(event.idn)
    && isObservedTraffic(event) && !eventEvidenceIds(event).some(id => judgedEvidence.has(id))
    && (filters.includeSupportTraffic || cellOperations.has(event.op) && !auxiliaryClasses.has(event.trafficClass)))
  const observedEvents = unjudgedEvents.filter(event => !cellOperations.has(event.op))
  const attachedEvents = unjudgedEvents.filter(event => cellOperations.has(event.op))
  const routeCandidates = filters.includeRouteCandidates ? projectRouteCandidates(snapshot, filters)
    : filters.includeSupportTraffic ? projectRouteCandidates(snapshot, { ...filters, includeRouteCandidates: true }).filter(isJavascriptHiddenApi) : []
  return { cells, observedEvents, attachedEvents, routeCandidates, resolveGroup }
}

export interface GraphReveal { operations?: readonly string[]; resource?: string; routeCandidateId?: string }

export function projectHierarchy(snapshot: Snapshot, filters: GraphFilters, navigation: GraphNavigation, reveal: GraphReveal = {}): HierarchyProjection {
  const identityMatches = (identity: string) => !filters.identity.length || filters.identity.includes(identity)
  const { cells, observedEvents, attachedEvents, routeCandidates: candidateList, resolveGroup } = graphContents(snapshot, filters)
  const operationGroup = (operation: string) => { const { service, path } = splitOperation(operation); return resolveGroup(service, path) }
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
      group = { ...descriptor, cells: [], operations: [], routeCandidates: [], endpointCount: 0, sourceCounts: { human: 0, scanner: 0, llm: 0 }, gapCount: 0, routeCandidateCount: 0, observedCount: 0 }
      groupsById.set(group.id, group)
    }
    return group
  }
  for (const cell of cells) {
    const group = ensure(operationGroup(cell.op))
    group.cells.push(cell)
  }
  // Route candidates keep the existing source/identity filter semantics of the flat projection.
  // "관측 전체"는 경로 후보 중 JS에서 찾은 미요청 API만 더한다(JS 파일 요청 자체는 그리지 않는다).
  for (const candidate of candidateList) {
    const group = ensure(resolveGroup(candidate.service, candidate.pathTemplate))
    group.routeCandidates.push(candidate)
  }
  const observedOperationsByGroup = new Map<string, Set<string>>()
  for (const event of observedEvents) {
    const id = ensure(operationGroup(event.op)).id
    observedOperationsByGroup.set(id, (observedOperationsByGroup.get(id) ?? new Set()).add(event.op))
  }
  for (const group of groupsById.values()) {
    group.operations = [...new Set(group.cells.map(cell => cell.op))]
    group.endpointCount = group.operations.length
    group.routeCandidateCount = group.routeCandidates.length
    group.observedCount = observedOperationsByGroup.get(group.id)?.size ?? 0
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
  let revealedNodeCount = 0
  let hiddenObjectCount = 0
  const addNode = (kind: HierarchyNode["kind"], key: string, selection = emptySelection(), extra: Partial<HierarchyNode> = {}) => {
    const id = `${kind}:${key}`
    const existing = nodes.find(node => node.id === id)
    if (existing) return existing
    // A display node is not a new authorization decision. Keep each server cell
    // in selection; only show a verdict when all selected cells already agree.
    const first = selection.cells[0]?.overall
    const verdict = first && selection.cells.every(cell => cell.overall === first) ? first : "unknown"
    const node: HierarchyNode = { id, kind, label: kind === "identity" ? graphAccountLabel(snapshot, key) : key, wrappedLabel: kind === "operation" ? wrapOperationLabel(key) : kind === "identity" ? graphAccountLabel(snapshot, key) : key, verdict, verdictText: verdictStyles[verdict].text, verdictColor: verdictStyles[verdict].color, selection, ...extra }
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

  // 미판정 관측은 기존 API의 근거만 보강한다. 판정 셀·객체·coverage는 만들지 않는다.
  const addAttached = (node: HierarchyNode) => {
    const events = attachedEvents.filter(event => event.op === node.selection.operation)
    node.selection = { ...node.selection, evidenceIds: [...new Set([...node.selection.evidenceIds, ...events.flatMap(eventEvidenceIds)])].sort(compareText) }
    const buckets = new Map<string, Snapshot["events"][number][]>()
    for (const event of events) {
      const key = JSON.stringify([event.idn, event.source])
      buckets.set(key, [...(buckets.get(key) ?? []), event])
    }
    for (const bucket of buckets.values()) {
      const { idn, source } = bucket[0]
      const evidenceIds = [...new Set(bucket.flatMap(eventEvidenceIds))].sort(compareText)
      const identity = addNode("identity", idn, { ...emptySelection(), identity: idn })
      identity.selection = { ...identity.selection, evidenceIds: [...new Set([...identity.selection.evidenceIds, ...evidenceIds])].sort(compareText) }
      addEdge("support", identity.id, node.id, { ...emptySelection(), identity: idn, operation: node.selection.operation, source, evidenceIds }, bucket.length)
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
        if (singles <= resolved.objectLimit) { addNode("resource", resource, resourceSelection(resource), resourceExtra(resource)); drawn.push(resource) }
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
    return { drawn, hidden: Math.max(0, singles - resolved.objectLimit) }
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
      const groupNode = addNode("operation-group", shape, selectionFor(related.filter(cell => ops.includes(cell.op))), { label: shape, wrappedLabel: wrapOperationLabel(shape), objectGroup: { key: shape, members: ops, owners: {}, expanded: open } })
      const members = ops.map(op => nodes.find(node => node.id === `operation:${op}`)).filter((node): node is HierarchyNode => !!node)
      groupNode.selection = { ...groupNode.selection, evidenceIds: [...new Set(members.flatMap(member => member.selection.evidenceIds))].sort(compareText) }
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
      const selection = { ...selectionFor(cells, parts[0].source), ...(parts[0].relation === "support" ? { identity: parts[0].selection.identity, evidenceIds: [...new Set(parts.flatMap(edge => edge.selection.evidenceIds))].sort(compareText) } : {}) }
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
    const priorities = new Map<string, number>()
    for (const cell of group.cells) {
      scores.set(cell.op, (scores.get(cell.op) ?? 0) + (cell.overall === "suspicious" ? 100 : cell.conflict ? 60 : isPartial(cell) ? 20 : 1) + cell.evidenceIds.length)
      const humanSignal = cell.perSource.human === "suspicious" || cell.perSource.human === "undecided" || isWriteOperation(cell.op) && cell.perSource.human !== undefined
      const signal = humanSignal || isWriteOperation(cell.op) || cell.overall === "suspicious" || cell.overall === "undecided" || cell.conflict
      priorities.set(cell.op, Math.min(priorities.get(cell.op) ?? 2, humanSignal ? 0 : signal ? 1 : 2))
    }
    const operations = [...group.operations].sort((left, right) => (priorities.get(left)! - priorities.get(right)!) || (scores.get(right) ?? 0) - (scores.get(left) ?? 0) || compareText(left, right))
    // 접지 않고 모두 그린다. 점검할 것(사람 신호 → 의심·확인 필요·충돌·쓰기)이 앞에 오고, 많으면 18개씩 넘긴다.
    const ordered = operations
    const listed = ordered.slice(0, resolved.operationLimit)
    for (const op of reveal.operations ?? []) if (ordered.includes(op) && !listed.includes(op)) { listed.push(op); revealedNodeCount++ }
    const visible = listed
    const related = group.cells.filter(cell => visible.includes(cell.op))
    for (const identity of new Set(related.map(cell => cell.idn))) addNode("identity", identity, selectionFor(related.filter(cell => cell.idn === identity)))
    listItems = visible.map(op => addNode("operation", op, selectionFor(related.filter(cell => cell.op === op))))
    addAccess(related)
    // 그룹 레벨에서도 객체(자원)를 세 번째 레인에 함께 그린다. 옛 그래프처럼 신원 → API → 객체를 한 화면에서 보되,
    // 객체가 많으면 objectLimit로 접고 "더 보기"로 펼친다(오퍼레이션 레벨과 같은 접기/펼치기).
    const resourceScores = new Map<string, number>()
    for (const cell of related) if (cell.resource) resourceScores.set(cell.resource, (resourceScores.get(cell.resource) ?? 0) + (cell.overall === "suspicious" ? 100 : cell.conflict ? 60 : 1))
    const groupResources = [...new Set(related.map(cell => cell.resource).filter((resource): resource is string => !!resource))].sort((left, right) => (resourceScores.get(right) ?? 0) - (resourceScores.get(left) ?? 0) || compareText(left, right))
    const objects = addObjects(groupResources, related, resource => ({ ...selectionFor(related.filter(cell => cell.resource === resource)), resource }), resource => ({ owner: snapshot.owners[resource] ?? null }), true)
    const visibleResources = objects.drawn
    for (const cell of related.filter(cell => cell.resource && visibleResources.includes(cell.resource))) for (const source of observedSources(cell).filter(source => filters.source.includes(source))) addEdge("operation-resource", `operation:${cell.op}`, `resource:${cell.resource}`, selectionFor([cell], source), sourceCount(cell, source))
    hiddenObjectCount = objects.hidden
    hiddenOperationCount = ordered.length - listed.length
    for (const node of listItems.filter(node => node.kind === "operation" && !node.hiddenInGraph)) addAttached(node)
    groupOperations(visible, related)
    const visibleRoutes = group.routeCandidates.slice(0, resolved.operationLimit)
    const revealedRoute = group.routeCandidates.find(candidate => candidate.id === reveal.routeCandidateId)
    if (revealedRoute && !visibleRoutes.includes(revealedRoute)) { visibleRoutes.push(revealedRoute); revealedNodeCount++ }
    routeCandidates = visibleRoutes
    for (const candidate of routeCandidates) addNode("route-candidate", candidate.id, { ...emptySelection(), ...candidate.selection }, { id: candidate.id, label: candidate.label, wrappedLabel: wrapOperationLabel(candidate.label) })
    if (filters.includeSupportTraffic) {
      const supportEvents = observedEvents.filter(event => operationGroup(event.op).id === group.id)
      const humanWrites = new Set(supportEvents.filter(event => event.source === "human" && isWriteOperation(event.op)).map(event => event.op))
      const allSupportOps = [...new Set(supportEvents.map(event => event.op))].sort((left, right) => Number(humanWrites.has(right)) - Number(humanWrites.has(left)) || Number(isWriteOperation(right)) - Number(isWriteOperation(left)) || compareText(left, right))
      const supportOps = allSupportOps.slice(0, resolved.operationLimit)
      for (const op of reveal.operations ?? []) if (allSupportOps.includes(op) && !supportOps.includes(op)) { supportOps.push(op); revealedNodeCount++ }
      hiddenOperationCount += allSupportOps.length - supportOps.length
      const supportEvidence = (event: Snapshot["events"][number]) => [...new Set([event.eventId, ...(event.clusterEvidenceIds ?? [])])]
      for (const op of supportOps) {
        const events = supportEvents.filter(event => event.op === op)
        listItems.push(addNode("observed-operation", op, { ...emptySelection(), operation: op, evidenceIds: [...new Set(events.flatMap(supportEvidence))].sort(compareText) }))
      }
      // 같은 신원·기능·출처의 반복 관측은 엣지 하나로 합친다. 개별 관측 기록은 선택 상세의 Evidence 목록에 모두 남는다.
      const buckets = new Map<string, Snapshot["events"][number][]>()
      for (const event of supportEvents.filter(event => supportOps.includes(event.op))) {
        const key = JSON.stringify([event.idn, event.op, event.source])
        const bucket = buckets.get(key)
        if (bucket) bucket.push(event); else buckets.set(key, [event])
      }
      for (const bucket of buckets.values()) {
        const { idn, op, source } = bucket[0]
        const identity = addNode("identity", idn, { ...emptySelection(), identity: idn })
        const evidenceIds = [...new Set(bucket.flatMap(supportEvidence))].sort(compareText)
        identity.selection = { ...identity.selection, evidenceIds: [...new Set([...identity.selection.evidenceIds, ...evidenceIds])].sort(compareText) }
        addEdge("support", `identity:${idn}`, `observed-operation:${op}`, { ...emptySelection(), identity: idn, operation: op, source, evidenceIds }, bucket.length)
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
    if (reveal.resource && resources.includes(reveal.resource) && !visible.includes(reveal.resource)) {
      addNode("resource", reveal.resource, { ...selectionFor(related.filter(cell => cell.resource === reveal.resource)), operation, resource: reveal.resource }, { owner: snapshot.owners[reveal.resource] ?? null, publicRead: isPublicRead(snapshot, operation, reveal.resource) })
      visible.push(reveal.resource); revealedNodeCount++; objects.hidden--
    }
    for (const identity of new Set([...related.map(cell => cell.idn), ...candidates.filter(gap => gap.resource && visible.includes(gap.resource)).map(gap => gap.idn)])) addNode("identity", identity, { ...selectionFor(related.filter(cell => cell.idn === identity)), identity })
    addAccess(related)
    addAttached(operationNode)
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
    listItems = related.map(cell => ({ id: `cell:${graphCellKey(cell)}${"observedIdentity" in cell ? ":" + JSON.stringify(cell.idn) : ""}`, kind: cell.resource ? "resource" : "operation", label: cell.resource ?? operation, wrappedLabel: cell.resource ?? wrapOperationLabel(operation), verdict: cell.overall, verdictText: verdictStyles[cell.overall].text, verdictColor: verdictStyles[cell.overall].color, selection: selectionFor([cell]), ...(cell.resource ? { owner: snapshot.owners[cell.resource] ?? null } : {}) }))
  }
  return { kind: resolved.level, view: filters.view, navigation: resolved, groups, nodes, edges, identities: nodes.filter(node => node.kind === "identity"), operations: nodes.filter(node => node.kind === "operation"), resources: nodes.filter(node => node.kind === "resource"), routeCandidates, listItems, hiddenOperationCount, hiddenObjectCount, revealedNodeCount }
}
