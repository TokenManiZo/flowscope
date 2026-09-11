import type { Snapshot, SurfaceAuthorizationTargetLink, SurfaceConfidence, SurfaceDeclaration, SurfaceEndpoint, SurfaceParameter, SurfaceParameterGap, SurfaceSource, SurfaceValidationCell } from "@/lib/api/types"
import { conditionNodeCard, inputNodeCard, operationNodeCard, targetNodeCard, type ParameterNodeCardView } from "./parameterNodeCard"

export type ParameterLane = "condition" | "operation" | "input" | "target"
export const parameterLaneOrder: readonly ParameterLane[] = ["condition", "operation", "input", "target"]
export const PARAMETER_GRAPH_PAGE_SIZE = 40
export const PARAMETER_EVIDENCE_PREVIEW_LIMIT = 20
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T

/** machine key = endpoint + location + canonicalPath (D-143). operation은 서버 event.op와 같은 전체 좌표다. */
export interface ParameterMapKey {
  service: string
  method: string
  pathTemplate: string
  operation: string
  location: string
  canonicalPath: string
  stableKey: string
}
export function parameterMapKey(endpoint: SurfaceEndpoint["key"], location: string, canonicalPath: string): ParameterMapKey {
  return {
    service: endpoint.service, method: endpoint.method, pathTemplate: endpoint.pathTemplate,
    operation: `${endpoint.service} ${endpoint.method} ${endpoint.pathTemplate}`, location, canonicalPath,
    stableKey: JSON.stringify([endpoint.service, endpoint.method, endpoint.pathTemplate, location, canonicalPath]),
  }
}
export function gapParameterKey(gap: SurfaceParameterGap): ParameterMapKey {
  return parameterMapKey(gap.endpoint, gap.location, gap.canonicalPath)
}
/** 서버 cell에는 id가 없다. 좌표·판정 전부로 만든 표시 전용 식별자. */
export type ProjectedValidationCell = SurfaceValidationCell & { id: string }
export function validationCellId(cell: SurfaceValidationCell): string {
  return JSON.stringify([cell.endpoint.service, cell.endpoint.method, cell.endpoint.pathTemplate, cell.location, cell.canonicalPath, cell.targetResource, cell.subjectClass, cell.source, cell.identity, cell.role, cell.verdict, cell.reason, cell.applicable])
}

export interface ParameterFilters {
  source: readonly SurfaceSource[]
  identity: readonly string[]
  gapTypes: readonly SurfaceParameterGap["type"][]
  statuses: readonly SurfaceParameterGap["status"][]
  riskOnly: boolean
  graphLimit: number
  priorityReasons?: readonly string[]
  /** 선언 type(OPENAPI/JAVASCRIPT_LITERAL/HTML_FORM/LLM_ARTIFACT_ANALYSIS …). 비어 있으면 전체. */
  definitionSources?: readonly string[]
}
// Empty source/identity/type lists mean all; an empty status list means none.
export const defaultParameterFilters: ParameterFilters = { source: [], identity: [], gapTypes: [], statuses: ["OPEN"], riskOnly: true, graphLimit: PARAMETER_GRAPH_PAGE_SIZE }
export type ParameterMapSelection = DeepReadonly<{
  gapId: string
  parameterKey: ParameterMapKey
  /** Gap witnesses, not executed validation Evidence. Count is server-owned. */
  evidenceIds: readonly string[]
  evidenceCount: number
}>
export type ParameterMapNode = DeepReadonly<{
  id: string
  lane: ParameterLane
  label: string
  confidence: SurfaceConfidence
  gapState: SurfaceParameterGap["status"]
  selection: ParameterMapSelection
  focused: boolean
  /** This node's own observation, never the associated input's state or a relation verdict. */
  observationState: "OBSERVED" | "NOT_OBSERVED" | "UNKNOWN"
  resource?: string | null
  owner?: string | null
  card: ParameterNodeCardView
}>
export type ParameterMapEdge = DeepReadonly<{
  id: string
  source: string
  target: string
  relation: "gap" | "observation" | "definition" | "unknown-input" | "authorization-target" | "unknown-target"
  line: "solid" | "dashed" | "dotted"
  trafficSource: SurfaceSource
  sourceLabel: "H" | "S" | "L" | "UNKNOWN"
  sourceRole: "GAP_SUBJECT" | "OBSERVATION" | "BASIS"
  sourceAttribution: readonly { source: SurfaceSource; label: "H" | "S" | "L" | "UNKNOWN"; observationCount: number }[]
  evidenceIds: readonly string[]
  evidenceCount: number
  selection: ParameterMapSelection
  focused: boolean
}>
export type ParameterGraphProjection = DeepReadonly<{
  queue: readonly SurfaceParameterGap[]
  nodes: readonly ParameterMapNode[]
  edges: readonly ParameterMapEdge[]
  selection?: ParameterMapSelection
  /** All selected-parameter cells, never mixed into Gap witnesses. Actual/basis counts stay separate. */
  validationCells: readonly ProjectedValidationCell[]
  definitions: readonly SurfaceDeclaration[]
  /** 선택 Gap의 파라미터 사실(프로파일·관측·권한 대상 포함). 선언만 있어도 존재한다. */
  parameter?: SurfaceParameter
  parameterKey?: ParameterMapKey
  /** 선택 파라미터의 endpoint 사실(요청 문맥·다른 파라미터 관측 포함). 요청 비교에 쓴다. */
  endpoint?: SurfaceEndpoint
  visibleGapIds: readonly string[]
  hiddenGapCount: number
  diagnostics: readonly string[]
  emptyState: "NO_DATA" | "DEFINITIONS_ONLY" | "NO_MATCHING_GAPS" | null
}>

const textOrder = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
// Mirrors ParameterGap.PRIORITY_ORDER; never rewrites server explanation lists.
const reasonOrder = ["CONFIRMED_AUTH_BOUNDARY", "AUTH_VARIANT_UNTESTED", "WRITE_METHOD", "CORROBORATED_EVIDENCE", "SOURCE_DISCREPANCY", "HUMAN_REVIEW_REQUIRED"]
const gapOrder = (a: SurfaceParameterGap, b: SurfaceParameterGap) => {
  for (const reason of reasonOrder) {
    const difference = Number(b.priorityReasons.includes(reason)) - Number(a.priorityReasons.includes(reason))
    if (difference) return difference
  }
  return textOrder(a.id, b.id)
}
const preview = (ids: readonly string[]) => [...new Set(ids)].slice(0, PARAMETER_EVIDENCE_PREVIEW_LIMIT)
const selectionFor = (gap: SurfaceParameterGap): ParameterMapSelection => ({ gapId: gap.id, parameterKey: gapParameterKey(gap), evidenceIds: preview(gap.evidenceIds), evidenceCount: gap.evidenceCount })
const sourceLabels = { HUMAN: "H", SCANNER: "S", LLM: "L", UNKNOWN: "UNKNOWN" } as const

/** Freeze only fresh copies: no returned nested reference can edit or freeze snapshot data. */
function immutableCopy<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object") return value as DeepReadonly<T>
  const copy = Array.isArray(value) ? value.map(immutableCopy)
    : Object.fromEntries(Object.entries(value).sort(([left], [right]) => textOrder(left, right)).map(([key, item]) => [key, immutableCopy(item)]))
  return Object.freeze(copy) as DeepReadonly<T>
}

/** Object field order is irrelevant; ordered reason/witness arrays remain meaningful. */
function sameFields(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => sameFields(value, right[index]))
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key)
    && sameFields((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
}

function uniqueIndex<T>(rows: readonly T[], keyFor: (row: T) => string, kind: string, diagnostics: string[]): Map<string, T> {
  const result = new Map<string, T>(), conflicts = new Set<string>()
  for (const row of rows) {
    const key = keyFor(row)
    if (conflicts.has(key)) continue
    const existing = result.get(key)
    if (existing && !sameFields(existing, row)) {
      result.delete(key)
      conflicts.add(key)
      diagnostics.push(`CONFLICTING_${kind}_ID: ${key}`)
    } else if (!existing) result.set(key, row)
  }
  return result
}

interface IndexedParameter { key: ParameterMapKey; parameter: SurfaceParameter; endpoint: SurfaceEndpoint }

/** discovery 프로파일이 실제 관측을 가지는가(선언만 있는 사실과 구분). */
export function parameterObserved(parameter: SurfaceParameter | undefined): boolean {
  return Boolean(parameter && (parameter.profile?.observationCount ?? 0) > 0 && parameter.observationEvidenceIds.length > 0)
}

/** Pure display projection over snapshot.surface. Joins are indexed once; graph work is limited to visible paths. */
export function projectParameterMap(snapshot: Snapshot, filters: ParameterFilters = defaultParameterFilters, selectedGapId: string | null = null): ParameterGraphProjection {
  const surface = snapshot.surface ?? { endpoints: [], extractions: [], probes: [] }
  const diagnostics = (surface.parameterDiagnostics ?? []).map(row => `${row.operation}: ${row.reasonCode} (${row.droppedCount})`)
  const parameters = new Map<string, IndexedParameter>()
  for (const endpoint of surface.endpoints) {
    for (const parameter of endpoint.parameters) {
      if (parameter.coordinateResolved === false) continue // 미확정 좌표는 Gap·경로 대상이 아니다(D-143)
      const key = parameterMapKey(endpoint.key, parameter.location, parameter.canonicalPath)
      parameters.set(key.stableKey, { key, parameter, endpoint })
    }
  }
  const actualOperationKey = (method: string, operation: string) => JSON.stringify([method, operation])
  const operationEvents = new Map<string, Map<string, number>>()
  const observedOperations = new Set<string>(), observedIdentities = new Map<string, Set<string>>()
  for (const event of snapshot.events) {
    if (!event.eventId) continue
    // op is the server's full canonical coordinate, including service. A cluster is not another EventRecord.
    const operation = actualOperationKey(event.method, event.op)
    const events = operationEvents.get(operation) ?? new Map<string, number>()
    if (!events.has(event.eventId)) events.set(event.eventId, event.status)
    operationEvents.set(operation, events)
    if (!event.coverageEligible) continue
    observedOperations.add(operation)
    const identities = observedIdentities.get(operation) ?? new Set<string>()
    if (event.idn.trim() && event.idn.toUpperCase() !== "UNKNOWN") identities.add(event.idn)
    observedIdentities.set(operation, identities)
  }
  for (const { key, parameter } of parameters.values()) if (parameterObserved(parameter)) {
    const operation = actualOperationKey(key.method, key.operation)
    observedOperations.add(operation)
    const identities = observedIdentities.get(operation) ?? new Set<string>()
    for (const [identity, count] of Object.entries(parameter.profile?.identityCounts ?? {})) if (identity.trim() && identity.toUpperCase() !== "UNKNOWN" && count > 0) identities.add(identity)
    observedIdentities.set(operation, identities)
  }
  const gaps = uniqueIndex(surface.parameterGaps ?? [], gap => gap.id, "GAP", diagnostics)
  const sources = new Set(filters.source), identities = new Set(filters.identity), types = new Set(filters.gapTypes), statuses = new Set(filters.statuses)
  const declarationsFor = (gap: SurfaceParameterGap) => parameters.get(gapParameterKey(gap).stableKey)?.parameter.declarations ?? []
  const queue = [...gaps.values()].filter(gap => statuses.has(gap.status)
    && (!filters.riskOnly || gap.priorityReasons.length > 0)
    && (!sources.size || sources.has(gap.source ?? "UNKNOWN"))
    && (!identities.size || identities.has(gap.identity ?? "UNKNOWN"))
    && (!types.size || types.has(gap.type))
    && (!filters.priorityReasons?.length || filters.priorityReasons.some(reason => gap.priorityReasons.includes(reason)))
    && (!filters.definitionSources?.length || declarationsFor(gap).some(declaration => filters.definitionSources!.includes(declaration.type)))).sort(gapOrder)
  const selected = selectedGapId ? queue.find(gap => gap.id === selectedGapId) : undefined
  const selection = selected ? selectionFor(selected) : undefined
  const limit = Number.isFinite(filters.graphLimit) ? Math.max(1, Math.min(1000, Math.floor(filters.graphLimit))) : PARAMETER_GRAPH_PAGE_SIZE
  const visible = queue.slice(0, limit)
  if (selected && !visible.some(gap => gap.id === selected.id)) visible.push(selected)
  const nodes: ParameterMapNode[] = [], edges: ParameterMapEdge[] = []
  for (const gap of visible) {
    const key = gapParameterKey(gap), indexed = parameters.get(key.stableKey), parameter = indexed?.parameter
    const declared = (parameter?.declarations.length ?? 0) > 0
    const candidate = gap.type === "DEFINED_NOT_OBSERVED" || (!parameterObserved(parameter) && declared)
    const observed = !candidate && parameterObserved(parameter)
    const canonical = selectionFor(gap), focused = selected?.id === gap.id
    const inputState = observed ? "OBSERVED" : candidate || (parameter && !parameterObserved(parameter)) ? "NOT_OBSERVED" : "UNKNOWN"
    const node = (lane: ParameterLane, label: string, confidence: SurfaceConfidence, observationState: ParameterMapNode["observationState"], card: ParameterNodeCardView, suffix = "", extra: Omit<Partial<ParameterMapNode>, "card"> = {}) => {
      const id = JSON.stringify([gap.id, lane, suffix])
      nodes.push({ id, lane, label, confidence, gapState: gap.status, selection: canonical, focused, observationState, card, ...extra })
      return id
    }
    const edge = (source: string, target: string, relation: ParameterMapEdge["relation"], line: ParameterMapEdge["line"], ids: readonly string[] = gap.evidenceIds, count = gap.evidenceCount) => {
      const sourceRole = relation === "gap" ? "GAP_SUBJECT" : relation === "observation" ? "OBSERVATION" : "BASIS"
      const sourceAttribution = relation === "observation" ? (["HUMAN", "SCANNER", "LLM", "UNKNOWN"] as const)
        .filter(value => (parameter?.profile?.sourceCounts[value] ?? 0) > 0).map(value => ({ source: value, label: sourceLabels[value], observationCount: parameter!.profile!.sourceCounts[value]! })) : []
      const trafficSource = sourceRole === "GAP_SUBJECT" ? gap.source ?? "UNKNOWN" : sourceAttribution.length === 1 ? sourceAttribution[0].source : "UNKNOWN"
      edges.push({ id: JSON.stringify([gap.id, source, target, relation]), source, target, relation, line, trafficSource, sourceLabel: sourceLabels[trafficSource], sourceRole, sourceAttribution, evidenceIds: preview(ids), evidenceCount: count, selection: canonical, focused })
    }
    const operationObserved = observedOperations.has(actualOperationKey(key.method, key.operation))
    const identityObserved = Boolean(gap.identity && observedIdentities.get(actualOperationKey(key.method, key.operation))?.has(gap.identity))
    const condition = node("condition", [gap.identity ?? "UNKNOWN", gap.role ?? "UNKNOWN"].join(" · "), "UNKNOWN", identityObserved ? "OBSERVED" : "UNKNOWN", conditionNodeCard(gap, parameter))
    const operationState = operationObserved ? "OBSERVED" : candidate ? "NOT_OBSERVED" : "UNKNOWN"
    const operation = node("operation", `${key.method} ${key.pathTemplate}`, operationObserved ? "OBSERVED" : candidate ? "INFERRED" : "UNKNOWN", operationState, operationNodeCard(key, [...operationEvents.get(actualOperationKey(key.method, key.operation))?.values() ?? []]))
    const input = node("input", `${key.location} ${key.canonicalPath}`, candidate ? "INFERRED" : observed ? "OBSERVED" : "UNKNOWN", inputState, inputNodeCard(key, gap, parameter))
    edge(condition, operation, candidate ? "definition" : "gap", candidate ? "dotted" : "dashed")
    edge(operation, input, candidate ? "definition" : observed ? "observation" : "unknown-input", observed ? "solid" : "dotted", parameter?.observationEvidenceIds ?? gap.evidenceIds, parameter?.observationEvidenceIds.length ?? gap.evidenceCount)
    const targets = [...uniqueIndex(parameter?.authorizationTargets ?? [], link => link.resource ?? "", "TARGET", diagnostics).values()].sort((a, b) => textOrder(a.resource ?? "", b.resource ?? ""))
    if (!targets.length) {
      const target = node("target", "UNKNOWN", "UNKNOWN", "UNKNOWN", targetNodeCard(null, "UNKNOWN", null, key.service), "", { resource: null, owner: null })
      edge(input, target, "unknown-target", "dotted", [], 0)
    }
    for (const link of targets.slice(0, 20)) {
      const resource = link.resource || null, owner = resource ? snapshot.owners[resource] || null : null
      const targetObserved = resource && link.evidenceCount > 0 && link.evidenceIds.length > 0 && (link.confidence === "OBSERVED" || link.confidence === "CORROBORATED")
      const targetConfidence = resource && owner ? link.confidence : "UNKNOWN"
      const target = node("target", resource ? `${resource} · ${owner ?? "UNKNOWN"}` : "UNKNOWN", targetConfidence, targetObserved ? "OBSERVED" : "UNKNOWN", targetNodeCard(resource, targetConfidence, owner, key.service), resource ?? "", { resource, owner })
      edge(input, target, resource ? "authorization-target" : "unknown-target", resource && (link.confidence === "OBSERVED" || link.confidence === "CORROBORATED") ? "solid" : "dotted", link.evidenceIds, link.evidenceCount)
    }
    if (targets.length > 20) diagnostics.push(`TARGET_PREVIEW_LIMIT: ${gap.id} (${targets.length})`)
  }
  const selectedKey = selected ? gapParameterKey(selected) : undefined
  const selectedIndexed = selectedKey ? parameters.get(selectedKey.stableKey) : undefined
  const selectedParameter = selectedIndexed?.parameter
  const validationCells = selectedKey ? [...uniqueIndex((surface.validationCells ?? []).filter(cell => parameterMapKey(cell.endpoint, cell.location, cell.canonicalPath).stableKey === selectedKey.stableKey)
    .map(cell => ({ ...cell, id: validationCellId(cell) })), cell => cell.id, "CELL", diagnostics).values()]
    .map(cell => ({ ...cell, evidenceIds: preview(cell.evidenceIds), basisEvidenceIds: preview(cell.basisEvidenceIds) })).sort((a, b) => textOrder(a.id, b.id)) : []
  const anyObserved = [...parameters.values()].some(item => parameterObserved(item.parameter))
  const anyDeclared = [...parameters.values()].some(item => item.parameter.declarations.length > 0)
  return immutableCopy({
    queue, nodes, edges, selection, validationCells,
    definitions: selectedParameter?.declarations ?? [],
    parameter: selectedParameter, parameterKey: selectedKey, endpoint: selectedIndexed?.endpoint,
    visibleGapIds: visible.map(gap => gap.id), hiddenGapCount: queue.length - visible.length,
    diagnostics: [...new Set(diagnostics)].sort(textOrder),
    emptyState: queue.length ? null : anyDeclared && !anyObserved ? "DEFINITIONS_ONLY"
      : gaps.size || parameters.size ? "NO_MATCHING_GAPS" : "NO_DATA",
  })
}

export type { SurfaceAuthorizationTargetLink }
